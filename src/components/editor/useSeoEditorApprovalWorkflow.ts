import { useCallback, useState } from 'react';
import { post } from '../../api/client';
import { filterWritableIds } from '../../hooks/admin/seoEditorFilters';
import {
  buildSeoApprovalItemsForPage,
  buildSeoApprovalItemsForSelection,
} from './seoEditorDerived';
import type { SeoEditState, SeoEditorPage } from './seoEditorTypes';

interface UseSeoEditorApprovalWorkflowArgs {
  workspaceId?: string;
  siteId: string;
  pages: SeoEditorPage[];
  edits: Record<string, SeoEditState>;
  filteredPageIds: string[];
  refreshStates: () => void;
  toast: (message: string) => void;
}

export function toggleStringSet(previous: Set<string>, id: string): Set<string> {
  const next = new Set(previous);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function toggleSelectAllInSet(previous: Set<string>, ids: string[]): Set<string> {
  const hasAllIdsSelected = ids.length > 0 && ids.every(id => previous.has(id));
  if (hasAllIdsSelected) return new Set();
  return new Set(ids);
}

export function useSeoEditorApprovalWorkflow({
  workspaceId,
  siteId,
  pages,
  edits,
  filteredPageIds,
  refreshStates,
  toast,
}: UseSeoEditorApprovalWorkflowArgs) {
  const [approvalSelected, setApprovalSelected] = useState<Set<string>>(new Set());
  const [sendingApproval, setSendingApproval] = useState(false);
  const [approvalSent, setApprovalSent] = useState(false);
  const [approvalRefreshKey, setApprovalRefreshKey] = useState(0);
  const [sendingPage, setSendingPage] = useState<Set<string>>(new Set());
  const [sentPage, setSentPage] = useState<Set<string>>(new Set());

  const toggleApprovalSelect = useCallback((pageId: string) => {
    setApprovalSelected(prev => toggleStringSet(prev, pageId));
  }, []);

  const selectAllForApproval = useCallback(() => {
    setApprovalSelected(prev => toggleSelectAllInSet(prev, filteredPageIds));
  }, [filteredPageIds]);

  const sendPageToClient = useCallback(async (pageId: string) => {
    if (!workspaceId) return;
    const page = pages.find(p => p.id === pageId);
    const edit = edits[pageId];
    if (!page || !edit || page.source === 'cms') return;
    const items = buildSeoApprovalItemsForPage(page, edit);
    if (items.length === 0) return;

    setSendingPage(prev => new Set(prev).add(pageId));
    try {
      await post(`/api/approvals/${workspaceId}`, {
        siteId,
        name: `SEO Review — ${page.title}`,
        items,
      });
      setSentPage(prev => new Set(prev).add(pageId));
      refreshStates();
      setTimeout(() => {
        setSentPage(prev => {
          const next = new Set(prev);
          next.delete(pageId);
          return next;
        });
      }, 4000);
    } catch (err) {
      console.error('SeoEditor sendPageToClient failed:', err);
      const message = err instanceof Error ? err.message : 'Failed to send for review';
      toast(message);
    } finally {
      setSendingPage(prev => {
        const next = new Set(prev);
        next.delete(pageId);
        return next;
      });
    }
  }, [workspaceId, pages, edits, siteId, refreshStates, toast]);

  const sendForApproval = useCallback(async () => {
    if (!workspaceId || approvalSelected.size === 0) return;
    setSendingApproval(true);
    try {
      const writablePageIds = filterWritableIds(Array.from(approvalSelected), pages);
      const items = buildSeoApprovalItemsForSelection(writablePageIds, pages, edits);
      if (items.length === 0) {
        toast('No changes detected on selected pages. Edit SEO fields first.');
        return;
      }
      await post(`/api/approvals/${workspaceId}`, {
        siteId,
        name: `SEO Changes — ${new Date().toLocaleDateString()}`,
        items,
      });
      setApprovalSent(true);
      refreshStates();
      setApprovalSelected(new Set());
      setApprovalRefreshKey(k => k + 1);
      setTimeout(() => setApprovalSent(false), 4000);
    } catch (err) {
      console.error('Failed to send for approval:', err);
      const message = err instanceof Error ? err.message : 'Failed to send for approval';
      toast(message);
    } finally {
      setSendingApproval(false);
    }
  }, [workspaceId, approvalSelected, pages, edits, siteId, refreshStates, toast]);

  return {
    approvalSelected,
    setApprovalSelected,
    sendingApproval,
    approvalSent,
    approvalRefreshKey,
    sendingPage,
    sentPage,
    toggleApprovalSelect,
    selectAllForApproval,
    sendPageToClient,
    sendForApproval,
  };
}
