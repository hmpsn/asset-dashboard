import { useState, useEffect, useMemo } from 'react';
import {
  Loader2, Save, ChevronDown, ChevronRight, Check, AlertCircle,
  Search, Sparkles, Wand2, Upload, Send, Clock, ArrowRight,
} from 'lucide-react';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { StatusBadge } from './ui/StatusBadge';
import { statusBorderClass } from './ui/statusConfig';
import { get, patch, post, getSafe } from '../api/client';
import { PendingApprovals } from './PendingApprovals';

interface SeoField {
  id: string;
  slug: string;
  displayName: string;
  type: string;
}

interface ApprovalItem {
  id: string;
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  field: string;
  collectionId?: string;
  currentValue: string;
  proposedValue: string;
  clientValue?: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

interface ApprovalBatch {
  id: string;
  workspaceId: string;
  siteId: string;
  name: string;
  items: ApprovalItem[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface CmsItem {
  id: string;
  fieldData: Record<string, unknown>;
}

interface CmsCollection {
  collectionId: string;
  collectionName: string;
  collectionSlug: string;
  seoFields: SeoField[];
  items: CmsItem[];
  total: number;
}

interface Props {
  siteId: string;
  workspaceId?: string;
}

export function CmsEditor({ siteId, workspaceId }: Props) {
  const [collections, setCollections] = useState<CmsCollection[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState<Set<string>>(new Set());
  const [published, setPublished] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [approvalSelected, setApprovalSelected] = useState<Set<string>>(new Set());
  const [sendingApproval, setSendingApproval] = useState(false);
  const [approvalSent, setApprovalSent] = useState(false);
  const [approvalRefreshKey, setApprovalRefreshKey] = useState(0);
  const [variations, setVariations] = useState<Record<string, { fieldSlug: string; options: string[] }>>({});
  const [approvalBatches, setApprovalBatches] = useState<ApprovalBatch[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState<Set<string>>(new Set());
  const { getState, refresh: refreshStates, summary } = usePageEditStates(workspaceId);

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await get<CmsCollection[]>(`/api/webflow/cms-seo/${siteId}`);
      setCollections(data);
      // Initialize edit state
      const editMap: Record<string, Record<string, string>> = {};
      for (const coll of data) {
        for (const item of coll.items) {
          const fields: Record<string, string> = {};
          for (const sf of coll.seoFields) {
            fields[sf.slug] = String(item.fieldData[sf.slug] || '');
          }
          editMap[item.id] = fields;
        }
      }
      setEdits(editMap);
      setDirty(new Set());
      setSaved(new Set());
      setErrors({});
    } catch (err) {
      console.error('CMS SEO fetch failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [siteId]);

  // Fetch approval batches for this workspace
  useEffect(() => {
    if (!workspaceId) return;
    getSafe<ApprovalBatch[]>(`/api/approvals/${workspaceId}`, [])
      .then(data => { if (Array.isArray(data)) setApprovalBatches(data); });
  }, [workspaceId]);

  // Build per-item approval lookup: itemId → approval items across all batches
  const itemApprovalMap = useMemo(() => {
    const map = new Map<string, Array<ApprovalItem & { batchName: string; batchId: string }>>();
    for (const batch of approvalBatches) {
      for (const item of batch.items) {
        if (!item.collectionId) continue; // only CMS items
        const list = map.get(item.pageId) || [];
        list.push({ ...item, batchName: batch.name, batchId: batch.id });
        map.set(item.pageId, list);
      }
    }
    return map;
  }, [approvalBatches]);

  const toggleHistory = (itemId: string) => {
    setHistoryExpanded(prev => {
      const n = new Set(prev);
      if (n.has(itemId)) n.delete(itemId); else n.add(itemId);
      return n;
    });
  };



  const updateField = (itemId: string, fieldSlug: string, value: string) => {
    setEdits(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], [fieldSlug]: value },
    }));
    setDirty(prev => new Set(prev).add(itemId));
    setSaved(prev => { const n = new Set(prev); n.delete(itemId); return n; });
  };

  const saveItem = async (collectionId: string, itemId: string) => {
    const fields = edits[itemId];
    if (!fields) return;
    setSaving(prev => new Set(prev).add(itemId));
    setErrors(prev => { const n = { ...prev }; delete n[itemId]; return n; });
    try {
      const result = await patch<{ success?: boolean; error?: string }>(`/api/webflow/collections/${collectionId}/items/${itemId}`, { fieldData: fields, workspaceId });
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

  const publishCollection = async (collectionId: string) => {
    const collItems = collections.find(c => c.collectionId === collectionId)?.items || [];
    const savedItemIds = collItems.filter(i => saved.has(i.id)).map(i => i.id);
    if (savedItemIds.length === 0) return;
    setPublishing(prev => new Set(prev).add(collectionId));
    try {
      const result = await post<{ success?: boolean }>(`/api/webflow/collections/${collectionId}/publish`, { itemIds: savedItemIds });
      if (result.success) {
        setPublished(prev => new Set(prev).add(collectionId));
        setTimeout(() => setPublished(prev => { const n = new Set(prev); n.delete(collectionId); return n; }), 3000);
      }
    } catch (err) { console.error('CmsEditor operation failed:', err); } finally {
      setPublishing(prev => { const n = new Set(prev); n.delete(collectionId); return n; });
    }
  };

  const aiRewrite = async (collectionId: string, itemId: string, fieldSlug: string) => {
    const key = `${itemId}-${fieldSlug}`;
    setAiLoading(prev => ({ ...prev, [key]: true }));
    try {
      const currentValue = edits[itemId]?.[fieldSlug] || '';
      const itemName = edits[itemId]?.['name'] || '';
      const isTitle = fieldSlug.includes('title') || fieldSlug === 'name';

      // Build context from the item's other field values so the AI can differentiate items
      const collection = collections.find(c => c.collectionId === collectionId);
      const itemFields = edits[itemId] || {};
      const fieldContext = Object.entries(itemFields)
        .filter(([slug, val]) => val && slug !== fieldSlug && slug !== 'name')
        .map(([slug, val]) => `${slug}: ${String(val).slice(0, 300)}`)
        .join('\n');
      const itemSlug = collection?.items.find(i => i.id === itemId)?.fieldData?.slug;
      const pagePath = itemSlug ? `/${collection?.collectionSlug}/${itemSlug}` : undefined;

      const data = await post<{ text?: string; variations?: string[] }>('/api/webflow/seo-rewrite', {
        pageTitle: itemName,
        currentSeoTitle: isTitle ? currentValue : undefined,
        currentDescription: !isTitle ? currentValue : undefined,
        pageContent: fieldContext || undefined,
        siteContext: collection ? `CMS collection: ${collection.collectionName}` : undefined,
        pagePath,
        field: isTitle ? 'title' : 'description',
        workspaceId,
      });
      if (data.variations && data.variations.length > 1) {
        updateField(itemId, fieldSlug, data.variations[0]);
        setVariations(prev => ({ ...prev, [itemId]: { fieldSlug, options: data.variations! } }));
      } else if (data.text) {
        updateField(itemId, fieldSlug, data.text);
      }
    } catch (err) { console.error('CmsEditor operation failed:', err); } finally {
      setAiLoading(prev => { const n = { ...prev }; delete n[key]; return n; });
    }
  };

  const toggleApprovalItem = (itemId: string) => {
    setApprovalSelected(prev => {
      const n = new Set(prev);
      if (n.has(itemId)) n.delete(itemId); else n.add(itemId);
      return n;
    });
  };

  const sendForApproval = async () => {
    if (!workspaceId || approvalSelected.size === 0) return;
    setSendingApproval(true);
    try {
      const items: Array<{ pageId: string; pageTitle: string; pageSlug: string; field: string; collectionId: string; currentValue: string; proposedValue: string }> = [];
      for (const itemId of approvalSelected) {
        const edit = edits[itemId];
        if (!edit) continue;
        // Find the collection and original item
        let coll: CmsCollection | undefined;
        let origItem: CmsItem | undefined;
        for (const c of collections) {
          const found = c.items.find(i => i.id === itemId);
          if (found) { coll = c; origItem = found; break; }
        }
        if (!coll || !origItem) continue;
        const itemName = String(origItem.fieldData['name'] || '');
        const itemSlug = String(origItem.fieldData['slug'] || '');
        // Check each editable field for changes
        for (const sf of coll.seoFields) {
          const original = String(origItem.fieldData[sf.slug] || '');
          const proposed = edit[sf.slug] || '';
          if (proposed !== original) {
            items.push({
              pageId: itemId, pageTitle: itemName, pageSlug: itemSlug,
              field: sf.slug, collectionId: coll.collectionId,
              currentValue: original, proposedValue: proposed,
            });
          }
        }
      }
      if (items.length === 0) {
        alert('No changes detected on selected items. Edit fields first.');
        setSendingApproval(false);
        return;
      }
      await post(`/api/approvals/${workspaceId}`, { siteId, name: `CMS SEO Changes — ${new Date().toLocaleDateString()}`, items });
      setApprovalSent(true);
      refreshStates();
      setApprovalSelected(new Set());
      setApprovalRefreshKey(k => k + 1);
      setTimeout(() => setApprovalSent(false), 4000);
    } catch (err) {
      console.error('Failed to send for approval:', err);
      alert('Failed to send for approval');
    } finally {
      setSendingApproval(false);
    }
  };

  const toggleCollection = (id: string) => {
    setExpandedCollections(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleItem = (id: string) => {
    setExpandedItems(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
        <span className="ml-3 text-sm text-zinc-400">Loading CMS collections...</span>
      </div>
    );
  }

  if (collections.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-500 text-sm">
        No CMS collections with items found for this site.
      </div>
    );
  }

  const totalItems = collections.reduce((s, c) => s + c.items.length, 0);
  const dirtyCount = dirty.size;
  const savedCount = saved.size;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">CMS Collection SEO</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Edit SEO-relevant fields on collection items &middot; {collections.length} collections &middot; {totalItems} items
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirtyCount > 0 && (
            <span className="text-[11px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
              {dirtyCount} unsaved
            </span>
          )}
          {savedCount > 0 && (
            <span className="text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
              {savedCount} saved (draft)
            </span>
          )}
          {workspaceId && (
            <button
              onClick={sendForApproval}
              disabled={sendingApproval || approvalSelected.size === 0}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                approvalSent ? 'bg-green-600 text-white' : 'bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white'
              }`}
            >
              {sendingApproval ? <Loader2 className="w-3 h-3 animate-spin" /> : approvalSent ? <Check className="w-3 h-3" /> : <Send className="w-3 h-3" />}
              {approvalSent ? 'Sent!' : sendingApproval ? 'Sending...' : `Send for Approval (${approvalSelected.size})`}
            </button>
          )}
        </div>
      </div>

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
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <span className="text-zinc-400 font-medium">{summary.total} tracked</span>
          {summary.live > 0 && <><StatusBadge status="live" /><span className="text-teal-400">{summary.live}</span></>}
          {summary.inReview > 0 && <><StatusBadge status="in-review" /><span className="text-purple-400">{summary.inReview}</span></>}
          {summary.approved > 0 && <><StatusBadge status="approved" /><span className="text-green-400">{summary.approved}</span></>}
          {summary.rejected > 0 && <><StatusBadge status="rejected" /><span className="text-red-400">{summary.rejected}</span></>}
          {summary.issueDetected > 0 && <><StatusBadge status="issue-detected" /><span className="text-amber-400">{summary.issueDetected}</span></>}
          {summary.fixProposed > 0 && <><StatusBadge status="fix-proposed" /><span className="text-blue-400">{summary.fixProposed}</span></>}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search items..."
          className="w-full pl-9 pr-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500"
        />
      </div>

      {/* Collections */}
      {collections.map(coll => {
        const filteredItems = coll.items.filter(item => {
          if (!search) return true;
          const q = search.toLowerCase();
          const name = String(item.fieldData['name'] || '').toLowerCase();
          const slug = String(item.fieldData['slug'] || '').toLowerCase();
          return name.includes(q) || slug.includes(q);
        });
        if (filteredItems.length === 0 && search) return null;
        const isExpanded = expandedCollections.has(coll.collectionId);
        const collSavedIds = coll.items.filter(i => saved.has(i.id)).map(i => i.id);
        const extraSeoFields = coll.seoFields.filter(f => f.slug !== 'name' && f.slug !== 'slug');
        const titleField = extraSeoFields.find(f => f.slug.includes('title'));
        const descField = extraSeoFields.find(f => f.slug.includes('description') || f.slug.includes('desc'));
        const missingTitles = titleField ? coll.items.filter(i => !String(i.fieldData[titleField.slug] || '').trim()).length : 0;
        const missingDescs = descField ? coll.items.filter(i => !String(i.fieldData[descField.slug] || '').trim()).length : 0;
        const missingNames = coll.items.filter(i => !String(i.fieldData['name'] || '').trim()).length;

        return (
          <div key={coll.collectionId} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            {/* Collection header */}
            <button
              onClick={() => toggleCollection(coll.collectionId)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/30 transition-colors"
            >
              <div className="flex items-center gap-2 flex-wrap">
                {isExpanded ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
                <span className="text-sm font-medium text-zinc-200">{coll.collectionName}</span>
                <span className="text-[11px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">/{coll.collectionSlug}</span>
                <span className="text-[11px] text-zinc-500">{coll.total} items</span>
                {extraSeoFields.length > 0 && (
                  <span className="text-[11px] text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded">
                    {extraSeoFields.map(f => f.displayName).join(', ')}
                  </span>
                )}
                {missingNames > 0 && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400">
                    {missingNames} missing names
                  </span>
                )}
                {missingTitles > 0 && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">
                    {missingTitles} missing SEO titles
                  </span>
                )}
                {missingDescs > 0 && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400">
                    {missingDescs} missing meta desc
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {collSavedIds.length > 0 && (
                  <span
                    onClick={e => { e.stopPropagation(); publishCollection(coll.collectionId); }}
                    className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 cursor-pointer"
                  >
                    {publishing.has(coll.collectionId) ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : published.has(coll.collectionId) ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <Upload className="w-3 h-3" />
                    )}
                    {published.has(coll.collectionId) ? 'Published!' : `Publish ${collSavedIds.length}`}
                  </span>
                )}
              </div>
            </button>

            {/* Items */}
            {isExpanded && (
              <div className="border-t border-zinc-800">
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
                    <div key={item.id} className={`border-b border-zinc-800/50 last:border-b-0 ${trackingBorder || (hasIssues ? 'border-l-2 border-l-amber-500/40' : '')}`}>
                      <button
                        onClick={() => toggleItem(item.id)}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/20 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {workspaceId && (
                            <input
                              type="checkbox"
                              checked={approvalSelected.has(item.id)}
                              onChange={e => { e.stopPropagation(); toggleApprovalItem(item.id); }}
                              onClick={e => e.stopPropagation()}
                              className="w-3.5 h-3.5 rounded border-zinc-600 text-teal-500 focus:ring-teal-500 bg-zinc-800 flex-shrink-0 cursor-pointer"
                            />
                          )}
                          {isItemExpanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />}
                          <span className={`text-xs truncate ${hasName ? 'text-zinc-300' : 'text-red-400 italic'}`}>{itemName || '(untitled)'}</span>
                          <span className="text-[11px] text-zinc-500 font-mono flex-shrink-0">/{coll.collectionSlug}/{itemSlug}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <StatusBadge status={getState(item.id)?.status} />
                          {!hasSeoTitle && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">No title</span>}
                          {!hasSeoDesc && <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400">No desc</span>}
                          {isDirty && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400">Unsaved</span>}
                          {isSaved && !isDirty && <Check className="w-3 h-3 text-emerald-400" />}
                          {error && <AlertCircle className="w-3 h-3 text-red-400" />}
                        </div>
                      </button>

                      {isItemExpanded && (
                        <div className="px-4 pb-4 space-y-3 bg-zinc-900/30">
                          {/* Name field */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">Name (Title)</label>
                              <div className="flex items-center gap-1">
                                <span className={`text-[11px] ${(() => { const len = (edits[item.id]?.['name'] || '').length; return len === 0 ? 'text-red-400' : len > 60 ? 'text-red-400' : len > 50 ? 'text-amber-400' : 'text-green-400'; })()}`}>{(edits[item.id]?.['name'] || '').length}/60</span>
                                <button
                                  onClick={() => aiRewrite(coll.collectionId, item.id, 'name')}
                                  disabled={!!aiLoading[`${item.id}-name`]}
                                  className="p-0.5 text-teal-400 hover:text-teal-300 disabled:opacity-50"
                                  title="AI rewrite"
                                >
                                  {aiLoading[`${item.id}-name`] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                                </button>
                              </div>
                            </div>
                            <input
                              type="text"
                              value={edits[item.id]?.['name'] || ''}
                              onChange={e => updateField(item.id, 'name', e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
                            />
                            {variations[item.id]?.fieldSlug === 'name' && variations[item.id].options.length > 1 && (
                              <div className="mt-1.5 space-y-1">
                                <div className="text-[10px] text-zinc-500 font-medium">Pick a variation:</div>
                                {variations[item.id].options.map((v, vi) => (
                                  <button
                                    key={vi}
                                    onClick={() => { updateField(item.id, 'name', v); setVariations(prev => { const n = { ...prev }; delete n[item.id]; return n; }); }}
                                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                                      (edits[item.id]?.['name'] || '') === v
                                        ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                                        : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-300 hover:border-teal-500/30 hover:bg-teal-600/10'
                                    }`}
                                  >
                                    <span className="text-zinc-500 mr-1">{vi + 1}.</span>{v}
                                    <span className={`ml-2 text-[10px] ${v.length > 60 ? 'text-red-400' : 'text-emerald-400'}`}>{v.length}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Slug field */}
                          <div>
                            <label className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mb-1 block">Slug</label>
                            <input
                              type="text"
                              value={edits[item.id]?.['slug'] || ''}
                              onChange={e => updateField(item.id, 'slug', e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 font-mono focus:outline-none focus:border-teal-500"
                            />
                          </div>

                          {/* Extra SEO fields */}
                          {extraSeoFields.map(field => {
                            const val = edits[item.id]?.[field.slug] || '';
                            const isTitle = field.slug.includes('title');
                            const charTarget = isTitle ? '30-60' : '50-160';
                            const charColor = isTitle
                              ? (val.length >= 30 && val.length <= 60 ? 'text-emerald-400' : val.length > 0 ? 'text-amber-400' : 'text-red-400')
                              : (val.length >= 50 && val.length <= 160 ? 'text-emerald-400' : val.length > 0 ? 'text-amber-400' : 'text-red-400');

                            return (
                              <div key={field.slug}>
                                <div className="flex items-center justify-between mb-1">
                                  <label className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">{field.displayName}</label>
                                  <div className="flex items-center gap-1">
                                    <span className={`text-[11px] ${charColor}`}>{val.length} chars ({charTarget})</span>
                                    <button
                                      onClick={() => aiRewrite(coll.collectionId, item.id, field.slug)}
                                      disabled={!!aiLoading[`${item.id}-${field.slug}`]}
                                      className="p-0.5 text-teal-400 hover:text-teal-300 disabled:opacity-50"
                                      title="AI rewrite"
                                    >
                                      {aiLoading[`${item.id}-${field.slug}`] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                                    </button>
                                  </div>
                                </div>
                                {isTitle ? (
                                  <input
                                    type="text"
                                    value={val}
                                    onChange={e => updateField(item.id, field.slug, e.target.value)}
                                    className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
                                  />
                                ) : (
                                  <textarea
                                    value={val}
                                    onChange={e => updateField(item.id, field.slug, e.target.value)}
                                    rows={3}
                                    className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500 resize-none"
                                  />
                                )}
                                {variations[item.id]?.fieldSlug === field.slug && variations[item.id].options.length > 1 && (
                                  <div className="mt-1.5 space-y-1">
                                    <div className="text-[10px] text-zinc-500 font-medium">Pick a variation:</div>
                                    {variations[item.id].options.map((v, vi) => {
                                      const maxLen = isTitle ? 60 : 160;
                                      return (
                                        <button
                                          key={vi}
                                          onClick={() => { updateField(item.id, field.slug, v); setVariations(prev => { const n = { ...prev }; delete n[item.id]; return n; }); }}
                                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                                            val === v
                                              ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                                              : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-300 hover:border-teal-500/30 hover:bg-teal-600/10'
                                          }`}
                                        >
                                          <span className="text-zinc-500 mr-1">{vi + 1}.</span>{v}
                                          <span className={`ml-2 text-[10px] ${v.length > maxLen ? 'text-red-400' : 'text-emerald-400'}`}>{v.length}/{maxLen}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {/* Save button + error */}
                          <div className="flex items-center justify-between pt-1">
                            <div>
                              {error && <span className="text-[11px] text-red-400">{error}</span>}
                              {isSaved && !isDirty && <span className="text-[11px] text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" /> Saved as draft</span>}
                            </div>
                            <button
                              onClick={() => saveItem(coll.collectionId, item.id)}
                              disabled={!isDirty || isSaving}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                            >
                              {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              Save
                            </button>
                          </div>

                          {/* Approval context + change history */}
                          {(() => {
                            const itemApprovals = itemApprovalMap.get(item.id);
                            if (!itemApprovals || itemApprovals.length === 0) return null;
                            const latest = itemApprovals[0]; // most recent first
                            const statusColors: Record<string, string> = {
                              pending: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
                              approved: 'text-green-400 bg-green-500/10 border-green-500/20',
                              rejected: 'text-red-400 bg-red-500/10 border-red-500/20',
                              applied: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
                            };
                            return (
                              <div className="mt-3 space-y-2">
                                {/* Inline: latest approval context */}
                                <div className="px-3 py-2 rounded-lg bg-zinc-800/40 border border-zinc-700/50">
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <Clock className="w-3 h-3 text-zinc-500" />
                                    <span className="text-[11px] font-medium text-zinc-400">Latest: {latest.batchName}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${statusColors[latest.status] || ''}`}>{latest.status}</span>
                                    <span className="text-[10px] text-zinc-600 ml-auto">{new Date(latest.updatedAt).toLocaleDateString()}</span>
                                  </div>
                                  <div className="flex items-center gap-2 text-[11px]">
                                    <span className="text-zinc-500 font-medium">{latest.field}</span>
                                    <span className="text-zinc-500 truncate max-w-[160px]">{latest.currentValue || '(empty)'}</span>
                                    <ArrowRight className="w-3 h-3 text-zinc-600 flex-shrink-0" />
                                    <span className="text-teal-300 truncate max-w-[200px]">{latest.clientValue || latest.proposedValue}</span>
                                  </div>
                                </div>

                                {/* Collapsible: full change history */}
                                {itemApprovals.length > 1 && (
                                  <>
                                    <button
                                      onClick={() => toggleHistory(item.id)}
                                      className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                                    >
                                      {historyExpanded.has(item.id) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                      {itemApprovals.length} changes in history
                                    </button>
                                    {historyExpanded.has(item.id) && (
                                      <div className="space-y-1.5 pl-3 border-l-2 border-zinc-800">
                                        {itemApprovals.slice(1).map(a => (
                                          <div key={a.id} className="px-2.5 py-1.5 rounded bg-zinc-800/30 text-[11px]">
                                            <div className="flex items-center gap-2 mb-0.5">
                                              <span className="text-zinc-500">{a.batchName}</span>
                                              <span className={`text-[10px] px-1 py-0.5 rounded border ${statusColors[a.status] || ''}`}>{a.status}</span>
                                              <span className="text-[10px] text-zinc-600 ml-auto">{new Date(a.updatedAt).toLocaleDateString()}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-zinc-500 font-medium">{a.field}:</span>
                                              <span className="text-zinc-500 truncate max-w-[140px]">{a.currentValue || '(empty)'}</span>
                                              <ArrowRight className="w-2.5 h-2.5 text-zinc-600 flex-shrink-0" />
                                              <span className="text-zinc-300 truncate max-w-[180px]">{a.clientValue || a.proposedValue}</span>
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
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Tip */}
      <div className="bg-zinc-800/30 rounded-lg border border-zinc-800 px-4 py-3">
        <div className="flex items-start gap-2">
          <Sparkles className="w-3.5 h-3.5 text-teal-400 mt-0.5 flex-shrink-0" />
          <div className="text-[11px] text-zinc-500">
            <strong className="text-zinc-400">How it works:</strong> Changes are saved as drafts first. Click <strong className="text-zinc-400">Publish</strong> on a collection to make changes live.
            The <Wand2 className="w-3 h-3 inline text-teal-400" /> button generates AI-optimized rewrites.
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
