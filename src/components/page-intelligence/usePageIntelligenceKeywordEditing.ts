import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { keywords } from '../../api/seo';
import { queryKeys } from '../../lib/queryKeys';
import type { UnifiedPage } from '../../../shared/types/page-join';
import type { KeywordStrategy } from '../../../shared/types/workspace';
import type { KeywordEditDraft } from './pageIntelligenceTypes';

interface UsePageIntelligenceKeywordEditingOptions {
  workspaceId: string;
  strategy: KeywordStrategy | null;
}

export function usePageIntelligenceKeywordEditing({
  workspaceId,
  strategy,
}: UsePageIntelligenceKeywordEditingOptions) {
  const queryClient = useQueryClient();
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<KeywordEditDraft>({ primary: '', secondary: '' });
  const [saving, setSaving] = useState(false);

  const startEdit = (page: UnifiedPage) => {
    if (!page.strategy) return;
    setEditingPageId(page.id);
    setEditDraft({
      primary: page.strategy.primaryKeyword,
      secondary: page.strategy.secondaryKeywords.join(', '),
    });
  };

  const saveEdit = async (page: UnifiedPage) => {
    if (!strategy || !page.strategy) return;
    setSaving(true);
    // page.strategy is a direct reference into strategy.pageMap — indexOf depends on object identity
    const pageIdx = (strategy.pageMap ?? []).indexOf(page.strategy);
    if (pageIdx === -1) { setSaving(false); return; }
    const updated = [...(strategy.pageMap ?? [])];
    updated[pageIdx] = {
      ...updated[pageIdx],
      primaryKeyword: editDraft.primary.trim(),
      secondaryKeywords: editDraft.secondary.split(',').map(s => s.trim()).filter(Boolean),
    };
    try {
      await keywords.patchStrategy(workspaceId, { pageMap: updated });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
      setEditingPageId(null);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  return {
    editingPageId,
    editDraft,
    saving,
    startEdit,
    saveEdit,
    setEditDraft,
    cancelEdit: () => setEditingPageId(null),
  };
}
