import { useMemo } from 'react';
import {
  Wand2, Sparkles, Search,
} from 'lucide-react';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { useCmsEditor } from '../hooks/admin';
import { EmptyState, LoadingState, Icon } from './ui';
import {
  buildItemApprovalMap,
} from './cms-editor/cmsEditorModel';
import { CmsEditorCollections } from './cms-editor/CmsEditorCollections';
import { CmsEditorShellPanels } from './cms-editor/CmsEditorShellPanels';
import { useCmsEditorShellState } from './cms-editor/useCmsEditorShellState';
import { useCmsEditorApprovalWorkflow } from './cms-editor/useCmsEditorApprovalWorkflow';
import { useCmsEditorAiWorkflow } from './cms-editor/useCmsEditorAiWorkflow';
import { useCmsEditorPublishBulkWorkflow } from './cms-editor/useCmsEditorPublishBulkWorkflow';
import { useCmsEditorSaveWorkflow } from './cms-editor/useCmsEditorSaveWorkflow';

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

  const { saveItem } = useCmsEditorSaveWorkflow({
    siteId,
    workspaceId,
    edits,
    setSaving,
    setErrors,
    setDirty,
    setSaved,
    refreshStates,
  });

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
      <CmsEditorShellPanels
        collections={collections}
        totalItems={totalItems}
        dirtyCount={dirtyCount}
        savedCount={savedCount}
        approvalSelectedCount={approvalSelected.size}
        sendingApproval={sendingApproval}
        approvalSent={approvalSent}
        sendForApproval={sendForApproval}
        bulkMode={bulkMode}
        bulkProgress={bulkProgress}
        bulkResults={bulkResults}
        onBulkAiRewrite={bulkAiRewrite}
        approvalError={approvalError}
        aiError={aiError}
        workspaceId={workspaceId}
        approvalRefreshKey={approvalRefreshKey}
        onApprovalRetracted={refreshStates}
        summary={summary}
        search={search}
        onSearchChange={setSearch}
      />

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
