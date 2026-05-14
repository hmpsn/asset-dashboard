import type { Dispatch, SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { patch } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';

interface UseCmsEditorSaveWorkflowArgs {
  siteId: string;
  workspaceId?: string;
  edits: Record<string, Record<string, string>>;
  setSaving: Dispatch<SetStateAction<Set<string>>>;
  setErrors: Dispatch<SetStateAction<Record<string, string>>>;
  setDirty: Dispatch<SetStateAction<Set<string>>>;
  setSaved: Dispatch<SetStateAction<Set<string>>>;
  refreshStates: () => void;
  queryClient: QueryClient;
}

export function useCmsEditorSaveWorkflow({
  siteId,
  workspaceId,
  edits,
  setSaving,
  setErrors,
  setDirty,
  setSaved,
  refreshStates,
  queryClient,
}: UseCmsEditorSaveWorkflowArgs) {
  const saveItem = async (collectionId: string, itemId: string) => {
    const fields = edits[itemId];
    if (!fields) return;

    setSaving(previous => new Set(previous).add(itemId));
    setErrors(previous => {
      const next = { ...previous };
      delete next[itemId];
      return next;
    });

    try {
      const result = await patch<{ success?: boolean; error?: string }>(
        `/api/webflow/collections/${collectionId}/items/${itemId}`,
        { fieldData: fields, siteId, workspaceId },
      );
      if (!result.success) {
        setErrors(previous => ({ ...previous, [itemId]: result.error || 'Save failed' }));
        return;
      }

      setDirty(previous => {
        const next = new Set(previous);
        next.delete(itemId);
        return next;
      });
      setSaved(previous => new Set(previous).add(itemId));
      refreshStates();
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.cmsEditor(siteId, workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId, workspaceId) });
    } catch (error) {
      console.error('CmsEditor operation failed:', error);
      setErrors(previous => ({ ...previous, [itemId]: 'Network error' }));
    } finally {
      setSaving(previous => {
        const next = new Set(previous);
        next.delete(itemId);
        return next;
      });
    }
  };

  return { saveItem };
}
