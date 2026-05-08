import { useMemo } from 'react';
import {
  Loader2, Save, ChevronDown, ChevronRight, Check, AlertCircle,
  Search, Sparkles, Wand2, Upload, Send, Clock, ArrowRight,
} from 'lucide-react';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { useCmsEditor } from '../hooks/admin';
import { EmptyState, LoadingState, ErrorState, CharacterCounter, SerpPreview, SocialPreview, SectionCard, Icon } from './ui';
import { StatusBadge } from './ui/StatusBadge';
import { statusBorderClass } from './ui/statusConfig';
import { patch } from '../api/client';
import { PendingApprovals } from './PendingApprovals';
import {
  buildItemApprovalMap,
  filterAndRankCollectionItems,
  getExtraSeoFields,
  getTitleAndDescriptionFields,
} from './cms-editor/cmsEditorModel';
import { useCmsEditorShellState } from './cms-editor/useCmsEditorShellState';
import { useCmsEditorApprovalWorkflow } from './cms-editor/useCmsEditorApprovalWorkflow';
import { useCmsEditorAiWorkflow } from './cms-editor/useCmsEditorAiWorkflow';
import { useCmsEditorPublishBulkWorkflow } from './cms-editor/useCmsEditorPublishBulkWorkflow';

interface Props {
  siteId: string;
  workspaceId?: string;
}

export function CmsEditor({ siteId, workspaceId }: Props) {
  const { data: cmsData, isLoading } = useCmsEditor(siteId, workspaceId);
  const collections = cmsData?.collections || [];
  const approvalBatches = cmsData?.approvalBatches || [];

  const {
    expandedCollections,
    setExpandedCollections,
    expandedItems,
    setExpandedItems,
    edits,
    dirty,
    setDirty,
    saving,
    setSaving,
    saved,
    setSaved,
    historyExpanded,
    search,
    setSearch,
    errors,
    setErrors,
    previewExpanded,
    toggleCollection,
    toggleItem,
    toggleHistory,
    togglePreview,
    updateField,
  } = useCmsEditorShellState({ siteId, collections });

  const { getState, refresh: refreshStates, summary } = usePageEditStates(workspaceId);
  const {
    approvalSelected,
    sendingApproval,
    approvalSent,
    approvalRefreshKey,
    approvalError,
    toggleApprovalItem,
    toggleSelectAllInCollection,
    sendForApproval,
  } = useCmsEditorApprovalWorkflow({
    workspaceId,
    siteId,
    edits,
    collections,
    refreshStates,
  });

  // Build per-item approval lookup: itemId → approval items across all batches
  const itemApprovalMap = useMemo(() => {
    return buildItemApprovalMap(approvalBatches);
  }, [approvalBatches]);

  const {
    variations,
    aiLoading,
    aiError,
    aiRewrite,
    aiRewriteBoth,
    applySingleVariation,
    applyPairedVariation,
  } = useCmsEditorAiWorkflow({
    siteId,
    workspaceId,
    collections,
    edits,
    updateField,
  });

  const {
    publishing,
    published,
    bulkMode,
    bulkProgress,
    bulkResults,
    publishCollection,
    bulkAiRewrite,
  } = useCmsEditorPublishBulkWorkflow({
    siteId,
    workspaceId,
    collections,
    saved,
    approvalSelected,
    setExpandedCollections,
    setExpandedItems,
    aiRewrite,
    aiRewriteBoth,
  });

  const saveItem = async (collectionId: string, itemId: string) => {
    const fields = edits[itemId];
    if (!fields) return;
    setSaving(prev => new Set(prev).add(itemId));
    setErrors(prev => { const n = { ...prev }; delete n[itemId]; return n; });
    try {
      const result = await patch<{ success?: boolean; error?: string }>(`/api/webflow/collections/${collectionId}/items/${itemId}`, { fieldData: fields, siteId, workspaceId });
      if (!result.success) {
        setErrors(prev => ({ ...prev, [itemId]: result.error || 'Save failed' }));
      } else {
        setDirty(prev => { const n = new Set(prev); n.delete(itemId); return n; });
        setSaved(prev => new Set(prev).add(itemId));
        refreshStates();
      }
    } catch (err) {
      console.error('CmsEditor operation failed:', err);
      setErrors(prev => ({ ...prev, [itemId]: 'Network error' }));
    } finally {
      setSaving(prev => { const n = new Set(prev); n.delete(itemId); return n; });
    }
  };

  if (isLoading) {
    return (
      <LoadingState 
        message="Loading CMS collections..."
        size="lg"
      />
    );
  }

  if (collections.length === 0) {
    return (
      <EmptyState icon={Search} title="No CMS collections with items found for this site" />
    );
  }

  const totalItems = collections.reduce((s, c) => s + c.items.length, 0);
  const dirtyCount = dirty.size;
  const savedCount = saved.size;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">CMS Collection SEO</h3>
          <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
            Edit SEO-relevant fields on collection items &middot; {collections.length} collections &middot; {totalItems} items
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirtyCount > 0 && (
            <span className="t-caption-sm text-amber-400/80 bg-amber-500/8 px-2 py-0.5 rounded">
              {dirtyCount} unsaved
            </span>
          )}
          {savedCount > 0 && (
            <span className="t-caption-sm text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
              {savedCount} saved (draft)
            </span>
          )}
          {approvalSelected.size > 0 && bulkMode === 'idle' && (
            <div className="flex items-center gap-1.5">
              <span className="t-caption-sm text-[var(--brand-text-muted)] mr-1">AI Rewrite:</span>
              <button onClick={() => bulkAiRewrite('name')} className="px-2 py-1 rounded t-caption-sm font-medium bg-teal-600/20 text-teal-400 hover:bg-teal-600/30 transition-colors">Names</button>
              <button onClick={() => bulkAiRewrite('title')} className="px-2 py-1 rounded t-caption-sm font-medium bg-teal-600/20 text-teal-400 hover:bg-teal-600/30 transition-colors">Titles</button>
              <button onClick={() => bulkAiRewrite('description')} className="px-2 py-1 rounded t-caption-sm font-medium bg-teal-600/20 text-teal-400 hover:bg-teal-600/30 transition-colors">Descriptions</button>
              <button onClick={() => bulkAiRewrite('all')} className="px-2 py-1 rounded t-caption-sm font-medium bg-teal-500/20 text-teal-300 hover:bg-teal-500/30 transition-colors">All SEO</button>
            </div>
          )}
          {bulkMode === 'rewriting' && (
            <div className="flex items-center gap-2 t-caption-sm text-teal-400">
              <Icon as={Loader2} size="sm" className="animate-spin" />
              Rewriting {bulkProgress.done}/{bulkProgress.total} items…
            </div>
          )}
          {workspaceId && (
            <button
              onClick={sendForApproval}
              disabled={sendingApproval || approvalSelected.size === 0}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] text-xs font-medium transition-colors ${
                approvalSent ? 'bg-emerald-600 text-white' : 'bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white'
              }`}
            >
              <Icon as={sendingApproval ? Loader2 : approvalSent ? Check : Send} size="sm" className={sendingApproval ? 'animate-spin' : ''} />
              {approvalSent ? 'Sent!' : sendingApproval ? 'Sending...' : `Send for Approval (${approvalSelected.size})`}
            </button>
          )}
        </div>
      </div>

      {/* Bulk rewrite results */}
      {bulkResults && (
        <div className="bg-teal-500/10 border border-teal-500/30 rounded-[var(--radius-lg)] px-3 py-2 text-xs text-teal-300 flex items-center gap-2">
          <Icon as={Sparkles} size="md" className="flex-shrink-0" />
          {bulkResults}
        </div>
      )}

      {/* Error States */}
      {approvalError && (
        <ErrorState
          type={approvalError.type === 'network' ? 'network' : 'data'}
          title={approvalError.type === 'network' ? 'Connection Error' : 'Validation Error'}
          message={approvalError.message}
        />
      )}
      {aiError && (
        <ErrorState
          type="data"
          title="AI Rewrite Error"
          message={aiError}
        />
      )}

      {/* Pending CMS approval batches sent to client */}
      {workspaceId && (
        <PendingApprovals
          workspaceId={workspaceId}
          refreshKey={approvalRefreshKey}
          onRetracted={() => refreshStates()}
        />
      )}

      {/* Edit status summary bar */}
      {summary.total > 0 && (
        <div className="flex items-center gap-3 t-caption-sm text-[var(--brand-text-muted)]">
          <span className="text-[var(--brand-text)] font-medium">{summary.total} tracked</span>
          {summary.live > 0 && <><StatusBadge status="live" /><span className="text-teal-400">{summary.live}</span></>}
          {summary.inReview > 0 && <><StatusBadge status="in-review" /><span className="text-blue-400">{summary.inReview}</span></>}
          {summary.approved > 0 && <><StatusBadge status="approved" /><span className="text-emerald-400/80">{summary.approved}</span></>}
          {summary.rejected > 0 && <><StatusBadge status="rejected" /><span className="text-red-400/80">{summary.rejected}</span></>}
          {summary.issueDetected > 0 && <><StatusBadge status="issue-detected" /><span className="text-amber-400/80">{summary.issueDetected}</span></>}
          {summary.fixProposed > 0 && <><StatusBadge status="fix-proposed" /><span className="text-blue-400">{summary.fixProposed}</span></>}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Icon as={Search} size="md" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search items..."
          className="w-full pl-9 pr-3 py-2 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-[var(--brand-border-hover)]"
        />
      </div>

      {/* Collections */}
      {collections.map(coll => {
        const filteredItems = filterAndRankCollectionItems(coll, search);
        if (filteredItems.length === 0 && search) return null;
        const isExpanded = expandedCollections.has(coll.collectionId);
        const collSavedIds = coll.items.filter(i => saved.has(i.id)).map(i => i.id);
        const filteredItemIds = filteredItems.map(i => i.id);
        const selectedInColl = filteredItemIds.filter(id => approvalSelected.has(id)).length;
        const allInCollSelected = filteredItemIds.length > 0 && selectedInColl === filteredItemIds.length;
        const extraSeoFields = getExtraSeoFields(coll.seoFields);
        const { titleField, descField } = getTitleAndDescriptionFields(extraSeoFields);
        const missingTitles = titleField ? coll.items.filter(i => !String(i.fieldData[titleField.slug] || '').trim()).length : 0;
        const missingDescs = descField ? coll.items.filter(i => !String(i.fieldData[descField.slug] || '').trim()).length : 0;
        const missingNames = coll.items.filter(i => !String(i.fieldData['name'] || '').trim()).length;

        return (
          <SectionCard key={coll.collectionId} noPadding className="overflow-hidden">
            {/* Collection header */}
            <button
              onClick={() => toggleCollection(coll.collectionId)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/30 transition-colors"
            >
              <div className="flex items-center gap-2 flex-wrap">
                {workspaceId && filteredItemIds.length > 0 && (
                  <input
                    type="checkbox"
                    checked={allInCollSelected}
                    onChange={e => { e.stopPropagation(); toggleSelectAllInCollection(filteredItemIds); }}
                    onClick={e => e.stopPropagation()}
                    className="w-3.5 h-3.5 rounded border-[var(--brand-border)] text-teal-500 focus:ring-teal-500 bg-[var(--surface-3)] flex-shrink-0 cursor-pointer"
                    title={allInCollSelected ? 'Deselect all in collection' : `Select all ${filteredItemIds.length} items`}
                  />
                )}
                <Icon as={isExpanded ? ChevronDown : ChevronRight} size="md" className="text-[var(--brand-text-muted)]" />
                <span className="text-sm font-medium text-[var(--brand-text-bright)]">{coll.collectionName}</span>
                <span className="t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded">/{coll.collectionSlug}</span>
                <span className="t-caption-sm text-[var(--brand-text-muted)]">{coll.total} items</span>
                {extraSeoFields.length > 0 && (
                  <span className="t-caption-sm text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded">
                    {extraSeoFields.map(f => f.displayName).join(', ')}
                  </span>
                )}
                {missingNames > 0 && (
                  <span className="t-caption-sm px-1.5 py-0.5 rounded bg-red-500/8 border border-red-500/30 text-red-400/80">
                    {missingNames} missing names
                  </span>
                )}
                {missingTitles > 0 && (
                  <span className="t-caption-sm px-1.5 py-0.5 rounded bg-amber-500/8 border border-amber-500/30 text-amber-400/80">
                    {missingTitles} missing SEO titles
                  </span>
                )}
                {missingDescs > 0 && (
                  <span className="t-caption-sm px-1.5 py-0.5 rounded bg-red-500/8 border border-red-500/30 text-red-400/80">
                    {missingDescs} missing meta desc
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selectedInColl > 0 && (
                  <span className="t-caption-sm text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded">
                    {selectedInColl} selected
                  </span>
                )}
                {collSavedIds.length > 0 && (
                  <span
                    onClick={e => { e.stopPropagation(); publishCollection(coll.collectionId); }}
                    className="flex items-center gap-1 t-caption-sm text-emerald-400 hover:text-emerald-300 cursor-pointer"
                  >
                    <Icon as={publishing.has(coll.collectionId) ? Loader2 : published.has(coll.collectionId) ? Check : Upload} size="sm" className={publishing.has(coll.collectionId) ? 'animate-spin' : ''} />
                    {published.has(coll.collectionId) ? 'Published!' : `Publish ${collSavedIds.length}`}
                  </span>
                )}
              </div>
            </button>

            {/* Items */}
            {isExpanded && (
              <div className="border-t border-[var(--brand-border)]">
                {(search ? filteredItems : coll.items).map(item => {
                  const itemName = String(item.fieldData['name'] || '');
                  const itemSlug = String(item.fieldData['slug'] || '');
                  const isItemExpanded = expandedItems.has(item.id);
                  const isDirty = dirty.has(item.id);
                  const isSaved = saved.has(item.id);
                  const isSaving = saving.has(item.id);
                  const error = errors[item.id];
                  const trackingBorder = statusBorderClass(getState(item.id)?.status);
                  const hasName = !!itemName.trim();
                  const hasSeoTitle = titleField ? !!String(item.fieldData[titleField.slug] || '').trim() : true;
                  const hasSeoDesc = descField ? !!String(item.fieldData[descField.slug] || '').trim() : true;
                  const hasIssues = !hasName || !hasSeoTitle || !hasSeoDesc;

                  return (
                    <div key={item.id} className={`border-b border-[var(--brand-border)]/50 last:border-b-0 ${trackingBorder || (hasIssues ? 'border-l-2 border-l-amber-500/40' : '')}`}>
                      <button
                        onClick={() => toggleItem(item.id)}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[var(--surface-3)]/20 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {workspaceId && (
                            <input
                              type="checkbox"
                              checked={approvalSelected.has(item.id)}
                              onChange={e => { e.stopPropagation(); toggleApprovalItem(item.id); }}
                              onClick={e => e.stopPropagation()}
                              className="w-3.5 h-3.5 rounded border-[var(--brand-border)] text-teal-500 focus:ring-teal-500 bg-[var(--surface-3)] flex-shrink-0 cursor-pointer"
                            />
                          )}
                          <Icon as={isItemExpanded ? ChevronDown : ChevronRight} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                          <span className={`text-xs truncate ${hasName ? 'text-[var(--brand-text-bright)]' : 'text-red-400/80 italic'}`}>{itemName || '(untitled)'}</span>
                          <span className="t-caption-sm text-[var(--brand-text-muted)] font-mono flex-shrink-0">/{coll.collectionSlug}/{itemSlug}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <StatusBadge status={getState(item.id)?.status} />
                          {!hasSeoTitle && <span className="t-caption-sm px-1.5 py-0.5 rounded bg-amber-500/8 border border-amber-500/30 text-amber-400/80">No title</span>}
                          {!hasSeoDesc && <span className="t-caption-sm px-1.5 py-0.5 rounded bg-red-500/8 border border-red-500/30 text-red-400/80">No desc</span>}
                          {isDirty && <span className="t-caption-sm px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400">Unsaved</span>}
                          {isSaved && !isDirty && <Icon as={Check} size="sm" className="text-emerald-400" />}
                          {error && <Icon as={AlertCircle} size="sm" className="text-red-400/80" />}
                          <button
                            onClick={(e) => { e.stopPropagation(); togglePreview(item.id); }}
                            className="flex items-center gap-1 px-2 py-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors"
                            title="Toggle preview"
                          >
                            👁️
                          </button>
                        </div>
                      </button>

                      {isItemExpanded && (
                        <div className="px-4 pb-4 space-y-3 bg-[var(--surface-2)]/30">
                          {/* Name field */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider">Name (Title)</label>
                              <div className="flex items-center gap-1">
                                <CharacterCounter 
                              current={(edits[item.id]?.['name'] || '').length} 
                              max={60} 
                              size="sm" 
                            />
                                <button
                                  onClick={() => aiRewrite(coll.collectionId, item.id, 'name')}
                                  disabled={!!aiLoading[`${item.id}-name`] || !!aiLoading[`${item.id}-both`]}
                                  className="p-0.5 text-teal-400 hover:text-teal-300 disabled:opacity-50"
                                  title="AI rewrite"
                                >
                                  <Icon as={aiLoading[`${item.id}-name`] ? Loader2 : Wand2} size="sm" className={aiLoading[`${item.id}-name`] ? 'animate-spin' : ''} />
                                </button>
                              </div>
                            </div>
                            <input
                              type="text"
                              value={edits[item.id]?.['name'] || ''}
                              onChange={e => updateField(item.id, 'name', e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text-bright)] focus:outline-none focus:border-[var(--brand-border-hover)]"
                            />
                            {variations[item.id]?.fieldSlug === 'name' && variations[item.id].options.length > 1 && (
                              <div className="mt-1.5 space-y-1">
                                <div className="t-caption-sm text-[var(--brand-text-muted)] font-medium">Pick a variation:</div>
                                {variations[item.id].options.map((v, vi) => (
                                  <button
                                    key={vi}
                                    onClick={() => applySingleVariation(item.id, 'name', v)}
                                    className={`w-full text-left px-2.5 py-1.5 rounded-[var(--radius-lg)] text-xs border transition-colors ${
                                      (edits[item.id]?.['name'] || '') === v
                                        ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                                        : 'bg-[var(--surface-3)]/60 border-[var(--brand-border)]/50 text-[var(--brand-text-bright)] hover:border-teal-500/30 hover:bg-teal-600/10'
                                    }`}
                                  >
                                    <span className="text-[var(--brand-text-muted)] mr-1">{vi + 1}.</span>{v}
                                    <CharacterCounter current={v.length} max={60} size="sm" className="ml-2" />
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Slug field */}
                          <div>
                            <label className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1 block">Slug</label>
                            <input
                              type="text"
                              value={edits[item.id]?.['slug'] || ''}
                              onChange={e => updateField(item.id, 'slug', e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text-bright)] font-mono focus:outline-none focus:border-[var(--brand-border-hover)]"
                            />
                          </div>

                          {/* Extra SEO fields */}
                          {extraSeoFields.map(field => {
                            const val = edits[item.id]?.[field.slug] || '';
                            const isTitle = field.slug.includes('title');

                            return (
                              <div key={field.slug}>
                                <div className="flex items-center justify-between mb-1">
                                  <label className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider">{field.displayName}</label>
                                  <div className="flex items-center gap-1">
                                    <CharacterCounter 
                                    current={val.length} 
                                    max={isTitle ? 60 : 160} 
                                    size="sm" 
                                  />
                                    <button
                                      onClick={() => aiRewrite(coll.collectionId, item.id, field.slug)}
                                      disabled={!!aiLoading[`${item.id}-${field.slug}`] || !!aiLoading[`${item.id}-both`]}
                                      className="p-0.5 text-teal-400 hover:text-teal-300 disabled:opacity-50"
                                      title="AI rewrite"
                                    >
                                      <Icon as={aiLoading[`${item.id}-${field.slug}`] ? Loader2 : Wand2} size="sm" className={aiLoading[`${item.id}-${field.slug}`] ? 'animate-spin' : ''} />
                                    </button>
                                  </div>
                                </div>
                                {isTitle ? (
                                  <input
                                    type="text"
                                    value={val}
                                    onChange={e => updateField(item.id, field.slug, e.target.value)}
                                    className="w-full px-2.5 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text-bright)] focus:outline-none focus:border-[var(--brand-border-hover)]"
                                  />
                                ) : (
                                  <textarea
                                    value={val}
                                    onChange={e => updateField(item.id, field.slug, e.target.value)}
                                    rows={3}
                                    className="w-full px-2.5 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text-bright)] focus:outline-none focus:border-[var(--brand-border-hover)] resize-none"
                                  />
                                )}
                                {variations[item.id]?.fieldSlug === field.slug && variations[item.id].options.length > 1 && (
                                  <div className="mt-1.5 space-y-1">
                                    <div className="t-caption-sm text-[var(--brand-text-muted)] font-medium">Pick a variation:</div>
                                    {variations[item.id].options.map((v, vi) => {
                                      const maxLen = isTitle ? 60 : 160;
                                    return (
                                      <button
                                        key={vi}
                                        onClick={() => applySingleVariation(item.id, field.slug, v)}
                                          className={`w-full text-left px-2.5 py-1.5 rounded-[var(--radius-lg)] text-xs border transition-colors ${
                                            val === v
                                              ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                                              : 'bg-[var(--surface-3)]/60 border-[var(--brand-border)]/50 text-[var(--brand-text-bright)] hover:border-teal-500/30 hover:bg-teal-600/10'
                                          }`}
                                        >
                                          <span className="text-[var(--brand-text-muted)] mr-1">{vi + 1}.</span>{v}
                                          <CharacterCounter current={v.length} max={maxLen} size="sm" className="ml-2" />
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {/* AI Generate Both + paired variation picker */}
                          {titleField && descField && (
                            <div className="space-y-2">
                              <button
                                onClick={() => aiRewriteBoth(coll.collectionId, item.id, titleField.slug, descField.slug)}
                                disabled={!!aiLoading[`${item.id}-both`]}
                                className="flex items-center gap-1 t-caption-sm bg-teal-600 hover:bg-teal-500 text-white font-medium px-2 py-1 rounded transition-colors disabled:opacity-50"
                                title="Generate paired title + description"
                              >
                                <Icon as={aiLoading[`${item.id}-both`] ? Loader2 : Sparkles} size="sm" className={aiLoading[`${item.id}-both`] ? 'animate-spin' : ''} />
                                AI Generate Both
                              </button>
                              {variations[item.id]?.fieldSlug === 'both' && variations[item.id].options.length > 0 && variations[item.id].descOptions && (
                                <div className="space-y-1.5 border border-teal-500/20 bg-teal-500/5 rounded-[var(--radius-lg)] p-3">
                                  <div className="t-caption-sm text-teal-400 font-medium">Pick a paired title + description:</div>
                                  {variations[item.id].options.map((titleV, i) => {
                                    const descV = variations[item.id].descOptions![i] || '';
                                    const isSelected = (edits[item.id]?.[titleField.slug] || '') === titleV && (edits[item.id]?.[descField.slug] || '') === descV;
                                    return (
                                      <button
                                        key={i}
                                        onClick={() => applyPairedVariation(item.id, titleField.slug, descField.slug, titleV, descV)}
                                        className={`w-full text-left px-3 py-2 rounded-[var(--radius-lg)] text-xs border transition-colors ${
                                          isSelected
                                            ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                                            : 'bg-[var(--surface-3)]/60 border-[var(--brand-border)]/50 text-[var(--brand-text-bright)] hover:border-teal-500/30 hover:bg-teal-600/10'
                                        }`}
                                      >
                                        <div className="flex items-center gap-2 mb-1">
                                          <span className="text-[var(--brand-text-muted)] font-bold">{i + 1}.</span>
                                          <span className="t-caption-sm px-1 py-0.5 rounded bg-blue-500/10 text-blue-400">Title</span>
                                          <span className="flex-1">{titleV}</span>
                                          <CharacterCounter current={titleV.length} max={60} size="sm" />
                                        </div>
                                        <div className="flex items-center gap-2 ml-4">
                                          <span className="t-caption-sm px-1 py-0.5 rounded bg-purple-500/10 text-purple-400">Desc</span>
                                          <span className="flex-1 text-[var(--brand-text)]">{descV}</span>
                                          <CharacterCounter current={descV.length} max={160} size="sm" />
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Save button + error */}
                          <div className="flex items-center justify-between pt-1">
                            <div>
                              {error && <span className="t-caption-sm text-red-400/80">{error}</span>}
                              {isSaved && !isDirty && <span className="t-caption-sm text-emerald-400 flex items-center gap-1"><Icon as={Check} size="sm" /> Saved as draft</span>}
                            </div>
                            <button
                              onClick={() => saveItem(coll.collectionId, item.id)}
                              disabled={!isDirty || isSaving}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                            >
                              <Icon as={isSaving ? Loader2 : Save} size="sm" className={isSaving ? 'animate-spin' : ''} />
                              Save
                            </button>
                          </div>

                          {/* Approval context + change history */}
                          {(() => {
                            const itemApprovals = itemApprovalMap.get(item.id);
                            if (!itemApprovals || itemApprovals.length === 0) return null;
                            const latest = itemApprovals[0]; // most recent first
                            const statusColors: Record<string, string> = {
                              pending: 'text-amber-400/80 bg-amber-500/8 border-amber-500/20',
                              approved: 'text-emerald-400/80 bg-emerald-500/8 border-emerald-500/20',
                              rejected: 'text-red-400/80 bg-red-500/8 border-red-500/20',
                              applied: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
                            };
                            return (
                              <div className="mt-3 space-y-2">
                                {/* Inline: latest approval context */}
                                <div className="px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/40 border border-[var(--brand-border)]/50">
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <Icon as={Clock} size="sm" className="text-[var(--brand-text-muted)]" />
                                    <span className="t-caption-sm font-medium text-[var(--brand-text)]">Latest: {latest.batchName}</span>
                                    <span className={`t-caption-sm px-1.5 py-0.5 rounded border ${statusColors[latest.status] || ''}`}>{latest.status}</span>
                                    <span className="t-micro text-[var(--brand-text-muted)]/60 ml-auto">{new Date(latest.updatedAt).toLocaleDateString()}</span>
                                  </div>
                                  <div className="flex items-center gap-2 t-caption-sm">
                                    <span className="text-[var(--brand-text-muted)] font-medium">{latest.field}</span>
                                    <span className="text-[var(--brand-text-muted)] truncate max-w-[160px]">{latest.currentValue || '(empty)'}</span>
                                    <Icon as={ArrowRight} size="sm" className="text-[var(--brand-text-muted)]/60 flex-shrink-0" />
                                    <span className="text-teal-300 truncate max-w-[200px]">{latest.clientValue || latest.proposedValue}</span>
                                  </div>
                                </div>

                                {/* Collapsible: full change history */}
                                {itemApprovals.length > 1 && (
                                  <>
                                    <button
                                      onClick={() => toggleHistory(item.id)}
                                      className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors"
                                    >
                                      <Icon as={historyExpanded.has(item.id) ? ChevronDown : ChevronRight} size="sm" />
                                      {itemApprovals.length} changes in history
                                    </button>
                                    {historyExpanded.has(item.id) && (
                                      <div className="space-y-1.5 pl-3 border-l-2 border-[var(--brand-border)]">
                                        {itemApprovals.slice(1).map(a => (
                                          <div key={a.id} className="px-2.5 py-1.5 rounded bg-[var(--surface-3)]/30 t-caption-sm">
                                            <div className="flex items-center gap-2 mb-0.5">
                                              <span className="text-[var(--brand-text-muted)]">{a.batchName}</span>
                                              <span className={`t-caption-sm px-1 py-0.5 rounded border ${statusColors[a.status] || ''}`}>{a.status}</span>
                                              <span className="t-micro text-[var(--brand-text-muted)]/60 ml-auto">{new Date(a.updatedAt).toLocaleDateString()}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-[var(--brand-text-muted)] font-medium">{a.field}:</span>
                                              <span className="text-[var(--brand-text-muted)] truncate max-w-[140px]">{a.currentValue || '(empty)'}</span>
                                              <Icon as={ArrowRight} size="sm" className="text-[var(--brand-text-muted)]/60 flex-shrink-0" />
                                              <span className="text-[var(--brand-text-bright)] truncate max-w-[180px]">{a.clientValue || a.proposedValue}</span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })()}

                          {/* Preview Section */}
                          {previewExpanded.has(item.id) && (
                            <div className="border-t border-[var(--brand-border)] pt-4 mt-4 space-y-4">
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="text-sm font-medium text-[var(--brand-text-bright)]">Preview</h4>
                                <button
                                  onClick={() => togglePreview(item.id)}
                                  className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] text-xs"
                                >
                                  Hide
                                </button>
                              </div>
                              
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {/* Google Search Preview */}
                                <div>
                                  <div className="text-xs font-medium text-[var(--brand-text)] mb-2">Google Search</div>
                                  <SerpPreview
                                    title={edits[item.id]?.[titleField?.slug ?? 'name'] || (titleField ? '' : itemName)}
                                    description={descField ? (edits[item.id]?.[descField.slug] || '') : ''}
                                    url={`/${coll.collectionSlug}/${itemSlug}`}
                                    siteName="Your Site"
                                    size="sm"
                                  />
                                </div>

                                {/* Social Media Preview */}
                                <div>
                                  <div className="text-xs font-medium text-[var(--brand-text)] mb-2">Facebook</div>
                                  <SocialPreview
                                    title={edits[item.id]?.[titleField?.slug ?? 'name'] || (titleField ? '' : itemName)}
                                    description={descField ? (edits[item.id]?.[descField.slug] || '') : ''}
                                    siteName="Your Site"
                                    platform="facebook"
                                    size="sm"
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        );
      })}

      {/* Tip */}
      <div className="bg-[var(--surface-3)]/30 rounded-[var(--radius-lg)] border border-[var(--brand-border)] px-4 py-3">
        <div className="flex items-start gap-2">
          <Icon as={Sparkles} size="md" className="text-teal-400 mt-0.5 flex-shrink-0" />
          <div className="t-caption-sm text-[var(--brand-text-muted)]">
            <strong className="text-[var(--brand-text)]">How it works:</strong> Changes are saved as drafts first. Click <strong className="text-[var(--brand-text)]">Publish</strong> on a collection to make changes live.
            The <Icon as={Wand2} size="sm" className="text-teal-400" /> button generates AI-optimized rewrites.
            {collections.some(c => c.seoFields.filter(f => f.slug !== 'name' && f.slug !== 'slug').length === 0) && (
              <span className="block mt-1 text-amber-400/80">
                Tip: Some collections don't have dedicated SEO fields. Consider adding "SEO Title" and "Meta Description" text fields in Webflow's collection schema for better control.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
