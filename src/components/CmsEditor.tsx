import { useMemo } from 'react';
import {
  Loader2, Check, Search, Sparkles, Wand2, Send,
} from 'lucide-react';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { useCmsEditor } from '../hooks/admin';
import { EmptyState, LoadingState, ErrorState, Icon } from './ui';
import { StatusBadge } from './ui/StatusBadge';
import { patch } from '../api/client';
import { PendingApprovals } from './PendingApprovals';
import {
  buildItemApprovalMap,
} from './cms-editor/cmsEditorModel';
import { CmsEditorCollections } from './cms-editor/CmsEditorCollections';
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

      <CmsEditorCollections
        collections={collections}
        search={search}
        workspaceId={workspaceId}
        edits={edits}
        dirty={dirty}
        saved={saved}
        saving={saving}
        errors={errors}
        expandedCollections={expandedCollections}
        expandedItems={expandedItems}
        previewExpanded={previewExpanded}
        historyExpanded={historyExpanded}
        approvalSelected={approvalSelected}
        publishing={publishing}
        published={published}
        aiLoading={aiLoading}
        variations={variations}
        itemApprovalMap={itemApprovalMap}
        getState={getState}
        toggleCollection={toggleCollection}
        toggleItem={toggleItem}
        togglePreview={togglePreview}
        toggleHistory={toggleHistory}
        toggleApprovalItem={toggleApprovalItem}
        toggleSelectAllInCollection={toggleSelectAllInCollection}
        updateField={updateField}
        saveItem={saveItem}
        publishCollection={publishCollection}
        aiRewrite={aiRewrite}
        aiRewriteBoth={aiRewriteBoth}
        applySingleVariation={applySingleVariation}
        applyPairedVariation={applyPairedVariation}
      />

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
