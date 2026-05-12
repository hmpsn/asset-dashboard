import { useCallback, useState } from 'react';
import { post } from '../../api/client';
import {
  buildApprovalPayloadItems,
  type CmsCollection,
} from './cmsEditorModel';

interface ApprovalErrorState {
  type: 'validation' | 'network';
  message: string;
}

interface UseCmsEditorApprovalWorkflowArgs {
  workspaceId?: string;
  siteId: string;
  edits: Record<string, Record<string, string>>;
  collections: CmsCollection[];
  refreshStates: () => void;
}

function toggleStringSet(previous: Set<string>, id: string): Set<string> {
  const next = new Set(previous);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function toggleStringIds(previous: Set<string>, ids: string[]): Set<string> {
  const hasAllIdsSelected = ids.length > 0 && ids.every(id => previous.has(id));
  const next = new Set(previous);
  if (hasAllIdsSelected) {
    ids.forEach(id => next.delete(id));
    return next;
  }
  ids.forEach(id => next.add(id));
  return next;
}

export function useCmsEditorApprovalWorkflow({
  workspaceId,
  siteId,
  edits,
  collections,
  refreshStates,
}: UseCmsEditorApprovalWorkflowArgs) {
  const [approvalSelected, setApprovalSelected] = useState<Set<string>>(new Set());
  const [sendingApproval, setSendingApproval] = useState(false);
  const [approvalSent, setApprovalSent] = useState(false);
  const [approvalRefreshKey, setApprovalRefreshKey] = useState(0);
  const [approvalError, setApprovalError] = useState<ApprovalErrorState | null>(null);

  const clearApprovalErrorLater = useCallback(() => {
    setTimeout(() => setApprovalError(null), 5000);
  }, []);

  const toggleApprovalItem = useCallback((itemId: string) => {
    setApprovalSelected(previous => toggleStringSet(previous, itemId));
  }, []);

  const toggleSelectAllInCollection = useCallback((collectionItemIds: string[]) => {
    setApprovalSelected(previous => toggleStringIds(previous, collectionItemIds));
  }, []);

  const sendForApproval = useCallback(async () => {
    if (!workspaceId || approvalSelected.size === 0) return;
    setSendingApproval(true);
    setApprovalError(null);
    try {
      const items = buildApprovalPayloadItems(approvalSelected, edits, collections);
      if (items.length === 0) {
        setApprovalError({
          type: 'validation',
          message: 'No changes detected on selected items. Edit fields first.',
        });
        clearApprovalErrorLater();
        return;
      }

      await post(`/api/approvals/${workspaceId}`, {
        siteId,
        name: `CMS SEO Changes — ${new Date().toLocaleDateString()}`,
        items,
      });

      setApprovalSent(true);
      refreshStates();
      setApprovalSelected(new Set());
      setApprovalRefreshKey(key => key + 1);
      setTimeout(() => setApprovalSent(false), 4000);
    } catch (err) {
      console.error('Failed to send for approval:', err);
      setApprovalError({
        type: 'network',
        message: 'Failed to send for approval. Please check your connection and try again.',
      });
      clearApprovalErrorLater();
    } finally {
      setSendingApproval(false);
    }
  }, [workspaceId, approvalSelected, edits, collections, siteId, refreshStates, clearApprovalErrorLater]);

  return {
    approvalSelected,
    sendingApproval,
    approvalSent,
    approvalRefreshKey,
    approvalError,
    toggleApprovalItem,
    toggleSelectAllInCollection,
    sendForApproval,
  };
}
