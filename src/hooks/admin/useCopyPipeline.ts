import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  copyGeneration,
  copyReview,
  copyBatch,
  copyExport,
  copyIntelligence,
} from '../../api/brand-engine';
import { useToast } from '../../components/Toast';
import type {
  CopySectionStatus,
  ExportRequest,
} from '../../../shared/types/copy-pipeline';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';
import { useJobProgress } from '../useJobProgress';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs';

// ═══ QUERIES ═══

export function useCopySections(wsId: string, entryId: string) {
  return useQuery({
    queryKey: queryKeys.admin.copySections(wsId, entryId),
    queryFn: () => copyReview.getSections(wsId, entryId),
    enabled: !!(wsId && entryId),
    staleTime: STALE_TIMES.NORMAL,
  });
}

export function useCopyStatus(wsId: string, entryId: string) {
  return useQuery({
    queryKey: queryKeys.admin.copyStatus(wsId, entryId),
    queryFn: () => copyReview.getStatus(wsId, entryId),
    enabled: !!(wsId && entryId),
    staleTime: STALE_TIMES.NORMAL,
  });
}

export function useCopyMetadata(wsId: string, entryId: string) {
  return useQuery({
    queryKey: queryKeys.admin.copyMetadata(wsId, entryId),
    queryFn: () => copyReview.getMetadata(wsId, entryId),
    enabled: !!(wsId && entryId),
    staleTime: STALE_TIMES.NORMAL,
  });
}

export function useCopyIntelligence(wsId: string) {
  return useQuery({
    queryKey: queryKeys.admin.copyIntelligence(wsId),
    queryFn: () => copyIntelligence.getAll(wsId),
    enabled: !!wsId,
    staleTime: STALE_TIMES.STABLE,
  });
}

export function usePromotablePatterns(wsId: string) {
  return useQuery({
    queryKey: queryKeys.admin.copyPromotable(wsId),
    queryFn: () => copyIntelligence.getPromotable(wsId),
    enabled: !!wsId,
    staleTime: STALE_TIMES.STABLE,
  });
}

export function useBatchJob(wsId: string, batchId: string | null) {
  return useQuery({
    queryKey: queryKeys.admin.copyBatch(wsId, batchId!),
    queryFn: () => copyBatch.getJob(wsId, batchId!),
    enabled: !!(wsId && batchId),
    staleTime: STALE_TIMES.NORMAL,
  });
}

// ═══ MUTATIONS ═══

/**
 * Enqueues an async copy generation job for a blueprint entry.
 *
 * Returns { startGenerate, isRunning, jobId, error } via useJobProgress.
 * Call startGenerate({ blueprintId, entryId, accumulatedSteering? }) to kick off.
 * On 'done' the copySections, copyStatus, and copyMetadata caches for the entry
 * are invalidated automatically.
 *
 * Replaces the old useMutation-based useGenerateCopy.
 * C3 and subsequent consumers MUST use this hook, not a new inline mutation.
 */
export function useGenerateCopy(wsId: string, blueprintId: string, entryId: string) {
  const { toast } = useToast();
  const { startJob, isRunning, jobId, error } = useJobProgress(
    BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION,
    [
      queryKeys.admin.copySections(wsId, entryId),
      queryKeys.admin.copyStatus(wsId, entryId),
      queryKeys.admin.copyMetadata(wsId, entryId),
    ],
    wsId,
  );

  const startGenerate = async (params?: { accumulatedSteering?: string[] }) => {
    const id = await startJob({ blueprintId, entryId, ...params });
    if (!id) toast('Copy generation failed to start', 'error');
    return id;
  };

  return { startGenerate, isRunning, jobId, error };
}

export function useRegenerateCopySection(wsId: string, blueprintId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ entryId, sectionId, note, highlight }: { entryId: string; sectionId: string; note: string; highlight?: string }) =>
      copyGeneration.regenerateSection(wsId, blueprintId, entryId, sectionId, { note, highlight }),
    onSuccess: (_data, { entryId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copySections(wsId, entryId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyStatus(wsId, entryId) });
    },
    onError: () => { toast('Regeneration failed', 'error'); },
  });
}

export function useSendEntryToClientReview(wsId: string, blueprintId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (entryId: string) => copyReview.sendEntryToClientReview(wsId, blueprintId, entryId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copySectionsAll(wsId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyStatusAll(wsId) });
      toast(`${data?.sent ?? 0} section${(data?.sent ?? 0) !== 1 ? 's' : ''} sent for client review`, 'success');
    },
    onError: () => { toast('Failed to send for client review', 'error'); },
  });
}

export function useUpdateSectionStatus(wsId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ sectionId, status }: { sectionId: string; status: CopySectionStatus }) =>
      copyReview.updateSectionStatus(wsId, sectionId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copySectionsAll(wsId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyStatusAll(wsId) });
    },
    onError: () => { toast('Failed to update status', 'error'); },
  });
}

export function useUpdateSectionText(wsId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ sectionId, copy }: { sectionId: string; copy: string }) =>
      copyReview.updateSectionText(wsId, sectionId, copy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copySectionsAll(wsId) });
    },
    onError: () => { toast('Failed to update copy', 'error'); },
  });
}

export function useAddSuggestion(wsId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ sectionId, originalText, suggestedText }: { sectionId: string; originalText: string; suggestedText: string }) =>
      copyReview.addSuggestion(wsId, sectionId, { originalText, suggestedText }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copySectionsAll(wsId) });
    },
    onError: () => { toast('Failed to add suggestion', 'error'); },
  });
}

export function useStartBatch(wsId: string, blueprintId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ entryIds, mode, batchSize }: { entryIds: string[]; mode?: string; batchSize?: number }) =>
      copyBatch.start(wsId, blueprintId, { entryIds, mode, batchSize }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyBatchAll(wsId) });
    },
    onError: () => { toast('Batch generation failed', 'error'); },
  });
}

export function useExportCopy(wsId: string, blueprintId: string) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: (request: ExportRequest) =>
      copyExport.export(wsId, blueprintId, request),
    onError: () => { toast('Export failed', 'error'); },
  });
}

export function useTogglePattern(wsId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ patternId, active }: { patternId: string; active: boolean }) =>
      copyIntelligence.update(wsId, patternId, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyIntelligence(wsId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyPromotable(wsId) });
    },
    onError: () => { toast('Failed to update pattern', 'error'); },
  });
}

export function useDeletePattern(wsId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (patternId: string) =>
      copyIntelligence.remove(wsId, patternId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyIntelligence(wsId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyPromotable(wsId) });
    },
    onError: () => { toast('Failed to delete pattern', 'error'); },
  });
}

export function useExtractPatterns(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (steeringNotes: string[]) =>
      copyIntelligence.extract(wsId, steeringNotes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyIntelligence(wsId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyPromotable(wsId) });
    },
  });
}

