import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Save,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react';
import { CharacterCounter, Icon, SectionCard, SerpPreview, SocialPreview } from '../ui';
import { StatusBadge } from '../ui/StatusBadge';
import { statusBorderClass } from '../ui/statusConfig';
import type { PageEditState } from '../../hooks/usePageEditStates';
import {
  filterAndRankCollectionItems,
  getExtraSeoFields,
  getTitleAndDescriptionFields,
  type ApprovalMapItem,
  type CmsCollection,
} from './cmsEditorModel';
import type { ItemVariations } from './useCmsEditorAiWorkflow';

interface CmsEditorCollectionsProps {
  collections: CmsCollection[];
  search: string;
  workspaceId?: string;
  edits: Record<string, Record<string, string>>;
  dirty: Set<string>;
  saved: Set<string>;
  saving: Set<string>;
  errors: Record<string, string>;
  expandedCollections: Set<string>;
  expandedItems: Set<string>;
  previewExpanded: Set<string>;
  historyExpanded: Set<string>;
  approvalSelected: Set<string>;
  publishing: Set<string>;
  published: Set<string>;
  aiLoading: Record<string, boolean>;
  variations: Record<string, ItemVariations>;
  itemApprovalMap: Map<string, ApprovalMapItem[]>;
  getState: (itemId: string) => PageEditState | undefined;
  toggleCollection: (collectionId: string) => void;
  toggleItem: (itemId: string) => void;
  togglePreview: (itemId: string) => void;
  toggleHistory: (itemId: string) => void;
  toggleApprovalItem: (itemId: string) => void;
  toggleSelectAllInCollection: (itemIds: string[]) => void;
  updateField: (itemId: string, fieldSlug: string, value: string) => void;
  saveItem: (collectionId: string, itemId: string) => void;
  publishCollection: (collectionId: string) => void;
  aiRewrite: (collectionId: string, itemId: string, fieldSlug: string) => Promise<boolean>;
  aiRewriteBoth: (collectionId: string, itemId: string, titleSlug: string, descSlug: string) => Promise<boolean>;
  applySingleVariation: (itemId: string, fieldSlug: string, value: string) => void;
  applyPairedVariation: (itemId: string, titleSlug: string, descSlug: string, titleValue: string, descValue: string) => void;
}

export function CmsEditorCollections({
  collections,
  search,
  workspaceId,
  edits,
  dirty,
  saved,
  saving,
  errors,
  expandedCollections,
  expandedItems,
  previewExpanded,
  historyExpanded,
  approvalSelected,
  publishing,
  published,
  aiLoading,
  variations,
  itemApprovalMap,
  getState,
  toggleCollection,
  toggleItem,
  togglePreview,
  toggleHistory,
  toggleApprovalItem,
  toggleSelectAllInCollection,
  updateField,
  saveItem,
  publishCollection,
  aiRewrite,
  aiRewriteBoth,
  applySingleVariation,
  applyPairedVariation,
}: CmsEditorCollectionsProps) {
  return (
    <>
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
        const missingNames = coll.items.filter(i => !String(i.fieldData.name || '').trim()).length;

        return (
          <SectionCard key={coll.collectionId} noPadding className="overflow-hidden">
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

            {isExpanded && (
              <div className="border-t border-[var(--brand-border)]">
                {(search ? filteredItems : coll.items).map(item => {
                  const itemName = String(item.fieldData.name || '');
                  const itemSlug = String(item.fieldData.slug || '');
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
                  const fallbackNameTitle = (edits[item.id]?.name || itemName || '').trim();
                  const configuredSeoTitle = titleField ? (edits[item.id]?.[titleField.slug] || '') : fallbackNameTitle;
                  const effectiveSeoTitle = configuredSeoTitle.trim() || fallbackNameTitle;

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
                            onClick={e => { e.stopPropagation(); togglePreview(item.id); }}
                            className="flex items-center gap-1 px-2 py-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors"
                            title="Toggle preview"
                          >
                            👁️
                          </button>
                        </div>
                      </button>

                      {isItemExpanded && (
                        <div className="px-4 pb-4 space-y-3 bg-[var(--surface-2)]/30">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider">Name (Title)</label>
                              <div className="flex items-center gap-1">
                                <CharacterCounter current={(edits[item.id]?.name || '').length} max={60} size="sm" />
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
                              value={edits[item.id]?.name || ''}
                              onChange={e => updateField(item.id, 'name', e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text-bright)] focus:outline-none focus:border-[var(--brand-border-hover)]"
                            />
                            {variations[item.id]?.fieldSlug === 'name' && variations[item.id].options.length > 1 && (
                              <div className="mt-1.5 space-y-1">
                                <div className="t-caption-sm text-[var(--brand-text-muted)] font-medium">Pick a variation:</div>
                                {variations[item.id].options.map((v, variationIndex) => (
                                  <button
                                    key={variationIndex}
                                    onClick={() => applySingleVariation(item.id, 'name', v)}
                                    className={`w-full text-left px-2.5 py-1.5 rounded-[var(--radius-lg)] text-xs border transition-colors ${
                                      (edits[item.id]?.name || '') === v
                                        ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                                        : 'bg-[var(--surface-3)]/60 border-[var(--brand-border)]/50 text-[var(--brand-text-bright)] hover:border-teal-500/30 hover:bg-teal-600/10'
                                    }`}
                                  >
                                    <span className="text-[var(--brand-text-muted)] mr-1">{variationIndex + 1}.</span>{v}
                                    <CharacterCounter current={v.length} max={60} size="sm" className="ml-2" />
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1 block">Slug</label>
                            <input
                              type="text"
                              value={edits[item.id]?.slug || ''}
                              onChange={e => updateField(item.id, 'slug', e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text-bright)] font-mono focus:outline-none focus:border-[var(--brand-border-hover)]"
                            />
                          </div>

                          {extraSeoFields.map(field => {
                            const val = edits[item.id]?.[field.slug] || '';
                            const isTitle = field.slug.includes('title');

                            return (
                              <div key={field.slug}>
                                <div className="flex items-center justify-between mb-1">
                                  <label className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider">{field.displayName}</label>
                                  <div className="flex items-center gap-1">
                                    <CharacterCounter current={val.length} max={isTitle ? 60 : 160} size="sm" />
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
                                    {variations[item.id].options.map((v, variationIndex) => {
                                      const maxLen = isTitle ? 60 : 160;
                                      return (
                                        <button
                                          key={variationIndex}
                                          onClick={() => applySingleVariation(item.id, field.slug, v)}
                                          className={`w-full text-left px-2.5 py-1.5 rounded-[var(--radius-lg)] text-xs border transition-colors ${
                                            val === v
                                              ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                                              : 'bg-[var(--surface-3)]/60 border-[var(--brand-border)]/50 text-[var(--brand-text-bright)] hover:border-teal-500/30 hover:bg-teal-600/10'
                                          }`}
                                        >
                                          <span className="text-[var(--brand-text-muted)] mr-1">{variationIndex + 1}.</span>{v}
                                          <CharacterCounter current={v.length} max={maxLen} size="sm" className="ml-2" />
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}

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
                                  {variations[item.id].options.map((titleVariation, variationIndex) => {
                                    const descVariation = variations[item.id].descOptions?.[variationIndex] || '';
                                    const isSelected = (edits[item.id]?.[titleField.slug] || '') === titleVariation
                                      && (edits[item.id]?.[descField.slug] || '') === descVariation;
                                    return (
                                      <button
                                        key={variationIndex}
                                        onClick={() => applyPairedVariation(item.id, titleField.slug, descField.slug, titleVariation, descVariation)}
                                        className={`w-full text-left px-3 py-2 rounded-[var(--radius-lg)] text-xs border transition-colors ${
                                          isSelected
                                            ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                                            : 'bg-[var(--surface-3)]/60 border-[var(--brand-border)]/50 text-[var(--brand-text-bright)] hover:border-teal-500/30 hover:bg-teal-600/10'
                                        }`}
                                      >
                                        <div className="flex items-center gap-2 mb-1">
                                          <span className="text-[var(--brand-text-muted)] font-bold">{variationIndex + 1}.</span>
                                          <span className="t-caption-sm px-1 py-0.5 rounded bg-blue-500/10 text-blue-400">Title</span>
                                          <span className="flex-1">{titleVariation}</span>
                                          <CharacterCounter current={titleVariation.length} max={60} size="sm" />
                                        </div>
                                        <div className="flex items-center gap-2 ml-4">
                                          <span className="t-caption-sm px-1 py-0.5 rounded bg-blue-500/10 text-blue-400">Desc</span>
                                          <span className="flex-1 text-[var(--brand-text)]">{descVariation}</span>
                                          <CharacterCounter current={descVariation.length} max={160} size="sm" />
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}

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

                          {(() => {
                            const itemApprovals = itemApprovalMap.get(item.id);
                            if (!itemApprovals || itemApprovals.length === 0) return null;
                            const latest = itemApprovals[0];
                            const statusColors: Record<string, string> = {
                              pending: 'text-amber-400/80 bg-amber-500/8 border-amber-500/20',
                              approved: 'text-emerald-400/80 bg-emerald-500/8 border-emerald-500/20',
                              rejected: 'text-red-400/80 bg-red-500/8 border-red-500/20',
                              applied: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
                            };
                            return (
                              <div className="mt-3 space-y-2">
                                <div className="px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/40 border border-[var(--brand-border)]/50">
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <Icon as={Clock} size="sm" className="text-[var(--brand-text-muted)]" />
                                    <span className="t-caption-sm font-medium text-[var(--brand-text)]">Latest: {latest.batchName}</span>
                                    <span className={`t-caption-sm px-1.5 py-0.5 rounded border ${statusColors[latest.status] || ''}`}>{latest.status}</span>
                                    <span className="t-micro text-[var(--brand-text-muted)]/60 ml-auto">{new Date(latest.updatedAt).toLocaleDateString()}</span>
                                  </div>
                                  <div className="flex items-center gap-2 t-caption-sm">
                                    <span className="text-[var(--brand-text-muted)] font-medium">{latest.field}</span>
                                    <span className="text-[var(--brand-text-muted)] break-words">{latest.currentValue || '(empty)'}</span>
                                    <Icon as={ArrowRight} size="sm" className="text-[var(--brand-text-muted)]/60 flex-shrink-0" />
                                    <span className="text-teal-300 break-words">{latest.clientValue || latest.proposedValue}</span>
                                  </div>
                                </div>

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
                                        {itemApprovals.slice(1).map(approval => (
                                          <div key={approval.id} className="px-2.5 py-1.5 rounded bg-[var(--surface-3)]/30 t-caption-sm">
                                            <div className="flex items-center gap-2 mb-0.5">
                                              <span className="text-[var(--brand-text-muted)]">{approval.batchName}</span>
                                              <span className={`t-caption-sm px-1 py-0.5 rounded border ${statusColors[approval.status] || ''}`}>{approval.status}</span>
                                              <span className="t-micro text-[var(--brand-text-muted)]/60 ml-auto">{new Date(approval.updatedAt).toLocaleDateString()}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-[var(--brand-text-muted)] font-medium">{approval.field}:</span>
                                              <span className="text-[var(--brand-text-muted)] break-words">{approval.currentValue || '(empty)'}</span>
                                              <Icon as={ArrowRight} size="sm" className="text-[var(--brand-text-muted)]/60 flex-shrink-0" />
                                              <span className="text-[var(--brand-text-bright)] break-words">{approval.clientValue || approval.proposedValue}</span>
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
                                <div>
                                  <div className="text-xs font-medium text-[var(--brand-text)] mb-2">Google Search</div>
                                  <SerpPreview
                                    title={effectiveSeoTitle}
                                    description={descField ? (edits[item.id]?.[descField.slug] || '') : ''}
                                    url={`/${coll.collectionSlug}/${itemSlug}`}
                                    siteName="Your Site"
                                    size="sm"
                                  />
                                </div>

                                <div>
                                  <div className="text-xs font-medium text-[var(--brand-text)] mb-2">Facebook</div>
                                  <SocialPreview
                                    title={effectiveSeoTitle}
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
    </>
  );
}
