import { useState, useEffect, useRef } from 'react';
import {
  Loader2, Save, Sparkles, Upload, ChevronDown, ChevronRight,
  Check, AlertCircle, Wand2, Send, CheckSquare, Square, AlertTriangle,
} from 'lucide-react';
import type { FixContext } from '../App';
import { useRecommendations } from '../hooks/useRecommendations';

interface PageMeta {
  id: string;
  title: string;
  slug: string;
  seo?: { title?: string; description?: string };
  openGraph?: { title?: string; description?: string; titleCopied?: boolean; descriptionCopied?: boolean };
}

interface EditState {
  seoTitle: string;
  seoDescription: string;
  dirty: boolean;
}

interface Props {
  siteId: string;
  workspaceId?: string;
  fixContext?: FixContext | null;
}

export function SeoEditor({ siteId, workspaceId, fixContext }: Props) {
  const { forPage: recsForPage, loaded: recsLoaded } = useRecommendations(workspaceId);
  const [pages, setPages] = useState<PageMeta[]>([]);  
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [aiLoading, setAiLoading] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [bulkFixing, setBulkFixing] = useState(false);
  const [bulkResults, setBulkResults] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [approvalSelected, setApprovalSelected] = useState<Set<string>>(new Set());
  const [sendingApproval, setSendingApproval] = useState(false);
  const [approvalSent, setApprovalSent] = useState(false);
  const [variations, setVariations] = useState<Record<string, { field: string; options: string[] }>>({});
  const [editTracking, setEditTracking] = useState<Record<string, { status: 'flagged' | 'in-review' | 'live'; updatedAt: string; fields?: string[] }>>({});

  const fetchPages = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/webflow/pages/${siteId}`);
      const data = await res.json();
      setPages(data);
      const editMap: Record<string, EditState> = {};
      for (const p of data) {
        editMap[p.id] = {
          seoTitle: p.seo?.title || '',
          seoDescription: p.seo?.description || '',
          dirty: false,
        };
      }
      setEdits(editMap);
    } catch {
      setPages([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPages(); }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch edit tracking data
  useEffect(() => {
    if (!workspaceId) return;
    fetch(`/api/workspaces/${workspaceId}/seo-edit-tracking`)
      .then(r => r.ok ? r.json() : {})
      .then(data => setEditTracking(data || {}))
      .catch(() => {});
  }, [workspaceId]);

  // Auto-expand target page from audit Fix→
  const fixConsumed = useRef(false);
  useEffect(() => {
    if (fixContext?.pageId && pages.length > 0 && !fixConsumed.current) {
      const match = pages.find(p => p.id === fixContext.pageId || p.slug === fixContext.pageSlug);
      if (match) {
        fixConsumed.current = true;
        setExpanded(new Set([match.id]));
        // Scroll to the page after a tick
        setTimeout(() => {
          const el = document.getElementById(`seo-editor-page-${match.id}`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    }
  }, [fixContext, pages]);

  useEffect(() => {
    setHasUnsaved(Object.values(edits).some(e => e.dirty));
  }, [edits]);

  const updateField = (pageId: string, field: keyof EditState, value: string) => {
    setEdits(prev => ({
      ...prev,
      [pageId]: { ...prev[pageId], [field]: value, dirty: true },
    }));
  };

  const savePage = async (pageId: string) => {
    const edit = edits[pageId];
    if (!edit) return;
    setSaving(prev => new Set(prev).add(pageId));
    try {
      const res = await fetch(`/api/webflow/pages/${pageId}/seo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId,
          seo: { title: edit.seoTitle, description: edit.seoDescription },
          openGraph: { title: edit.seoTitle, description: edit.seoDescription },
        }),
      });
      const data = await res.json();
      if (data.success === false) {
        console.error('Save failed:', data.error);
        alert(`Failed to save SEO: ${data.error || 'Unknown error'}`);
        return;
      }
      setEdits(prev => ({ ...prev, [pageId]: { ...prev[pageId], dirty: false } }));
      setSaved(prev => new Set(prev).add(pageId));
      // Update local tracking state to show teal/live immediately
      setEditTracking(prev => ({ ...prev, [pageId]: { status: 'live', updatedAt: new Date().toISOString(), fields: ['title', 'description'] } }));
      setTimeout(() => setSaved(prev => { const n = new Set(prev); n.delete(pageId); return n; }), 2000);
    } catch (err) {
      console.error('Save failed:', err);
      alert('Network error saving SEO fields');
    } finally {
      setSaving(prev => { const n = new Set(prev); n.delete(pageId); return n; });
    }
  };

  const aiRewrite = async (pageId: string, field: 'title' | 'description') => {
    const page = pages.find(p => p.id === pageId);
    if (!page) return;
    const edit = edits[pageId];
    setAiLoading(prev => ({ ...prev, [pageId]: field }));
    try {
      const res = await fetch('/api/webflow/seo-rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageTitle: page.title,
          currentSeoTitle: edit?.seoTitle || page.seo?.title,
          currentDescription: edit?.seoDescription || page.seo?.description,
          field,
          workspaceId,
          pagePath: `/${page.slug || ''}`,
        }),
      });
      const data = await res.json();
      if (data.variations?.length > 1) {
        // Show variation picker — auto-select the first one
        const key = field === 'title' ? 'seoTitle' : 'seoDescription';
        updateField(pageId, key, data.variations[0]);
        setVariations(prev => ({ ...prev, [pageId]: { field, options: data.variations } }));
      } else if (data.text) {
        const key = field === 'title' ? 'seoTitle' : 'seoDescription';
        updateField(pageId, key, data.text);
      }
    } catch (err) {
      console.error('AI rewrite failed:', err);
    } finally {
      setAiLoading(prev => { const n = { ...prev }; delete n[pageId]; return n; });
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const res = await fetch(`/api/webflow/publish/${siteId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setPublished(true);
        setTimeout(() => setPublished(false), 3000);
      }
    } catch (err) {
      console.error('Publish failed:', err);
    } finally {
      setPublishing(false);
    }
  };

  const handleBulkFix = async (field: 'title' | 'description') => {
    const pagesNeedingFix = pages.filter(p => {
      if (field === 'title') return !p.seo?.title;
      return !p.seo?.description;
    });
    if (pagesNeedingFix.length === 0) {
      setBulkResults(`All pages already have ${field === 'title' ? 'SEO titles' : 'meta descriptions'}.`);
      setTimeout(() => setBulkResults(null), 3000);
      return;
    }
    setBulkFixing(true);
    setBulkResults(null);
    try {
      const res = await fetch(`/api/webflow/seo-bulk-fix/${siteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field,
          pages: pagesNeedingFix.map(p => ({
            pageId: p.id,
            title: p.title,
            currentSeoTitle: p.seo?.title,
            currentDescription: p.seo?.description,
          })),
        }),
      });
      const data = await res.json();
      const applied = data.results?.filter((r: { applied: boolean }) => r.applied).length || 0;
      setBulkResults(`AI generated ${field === 'title' ? 'titles' : 'descriptions'} for ${applied} of ${pagesNeedingFix.length} pages and pushed to Webflow.`);
      fetchPages();
      setTimeout(() => setBulkResults(null), 5000);
    } catch {
      setBulkResults('Bulk fix failed.');
    } finally {
      setBulkFixing(false);
    }
  };

  const toggleApprovalSelect = (pageId: string) => {
    setApprovalSelected(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId); else next.add(pageId);
      return next;
    });
  };

  const selectAllForApproval = () => {
    if (approvalSelected.size === filteredPages.length) {
      setApprovalSelected(new Set());
    } else {
      setApprovalSelected(new Set(filteredPages.map(p => p.id)));
    }
  };

  const sendForApproval = async () => {
    if (!workspaceId || approvalSelected.size === 0) return;
    setSendingApproval(true);
    try {
      const items: Array<{ pageId: string; pageTitle: string; pageSlug: string; field: 'seoTitle' | 'seoDescription'; currentValue: string; proposedValue: string }> = [];
      for (const pageId of approvalSelected) {
        const page = pages.find(p => p.id === pageId);
        const edit = edits[pageId];
        if (!page || !edit) continue;
        // Include title if changed from original
        if (edit.seoTitle !== (page.seo?.title || '')) {
          items.push({
            pageId, pageTitle: page.title, pageSlug: page.slug,
            field: 'seoTitle', currentValue: page.seo?.title || '', proposedValue: edit.seoTitle,
          });
        }
        // Include description if changed from original
        if (edit.seoDescription !== (page.seo?.description || '')) {
          items.push({
            pageId, pageTitle: page.title, pageSlug: page.slug,
            field: 'seoDescription', currentValue: page.seo?.description || '', proposedValue: edit.seoDescription,
          });
        }
      }
      if (items.length === 0) {
        alert('No changes detected on selected pages. Edit SEO fields first.');
        setSendingApproval(false);
        return;
      }
      await fetch(`/api/approvals/${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, name: `SEO Changes — ${new Date().toLocaleDateString()}`, items }),
      });
      setApprovalSent(true);
      // Update local tracking to in-review for all submitted pages
      const uniquePageIds = [...new Set(items.map((i: { pageId: string }) => i.pageId))];
      setEditTracking(prev => {
        const next = { ...prev };
        for (const pid of uniquePageIds) {
          next[pid] = { status: 'in-review', updatedAt: new Date().toISOString() };
        }
        return next;
      });
      setApprovalSelected(new Set());
      setTimeout(() => setApprovalSent(false), 4000);
    } catch (err) {
      console.error('Failed to send for approval:', err);
      alert('Failed to send for approval');
    } finally {
      setSendingApproval(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filteredPages = pages.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.title.toLowerCase().includes(q) || (p.slug || '').toLowerCase().includes(q);
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-sm">Loading page metadata...</p>
      </div>
    );
  }

  const missingTitles = pages.filter(p => !p.seo?.title).length;
  const missingDescs = pages.filter(p => !p.seo?.description).length;

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="text-sm text-zinc-400">
          <span className="font-medium text-zinc-200">{pages.length}</span> pages
        </div>
        {missingTitles > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">
            {missingTitles} missing SEO titles
          </span>
        )}
        {missingDescs > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400">
            {missingDescs} missing meta descriptions
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => handleBulkFix('title')}
          disabled={bulkFixing || missingTitles === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
        >
          <Wand2 className="w-3 h-3" /> AI Fix Titles ({missingTitles})
        </button>
        <button
          onClick={() => handleBulkFix('description')}
          disabled={bulkFixing || missingDescs === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
        >
          <Wand2 className="w-3 h-3" /> AI Fix Descriptions ({missingDescs})
        </button>
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
        <button
          onClick={handlePublish}
          disabled={publishing}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            published ? 'bg-green-600 text-white' : 'bg-white text-black hover:bg-zinc-200'
          }`}
        >
          {publishing ? <Loader2 className="w-3 h-3 animate-spin" /> : published ? <Check className="w-3 h-3" /> : <Upload className="w-3 h-3" />}
          {published ? 'Published!' : publishing ? 'Publishing...' : 'Publish Site'}
        </button>
      </div>

      {bulkFixing && (
        <div className="flex items-center gap-2 px-4 py-3 bg-teal-500/10 border border-teal-500/30 rounded-lg text-sm text-teal-300">
          <Loader2 className="w-4 h-4 animate-spin" /> AI is generating content for {missingTitles + missingDescs} pages...
        </div>
      )}
      {bulkResults && (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-500/10 border border-green-500/30 rounded-lg text-sm text-green-300">
          <Check className="w-4 h-4" /> {bulkResults}
        </div>
      )}

      {/* Edit tracking legend */}
      {Object.keys(editTracking).length > 0 && (
        <div className="flex items-center gap-4 text-[11px] text-zinc-500">
          <span>Edit status:</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-teal-400" /> Live</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400" /> In Review</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Flagged</span>
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search pages..."
        className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-600"
      />

      {hasUnsaved && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-400">
          <AlertCircle className="w-3.5 h-3.5" /> You have unsaved changes. Save individual pages then publish to go live.
        </div>
      )}

      {/* Select all for approval */}
      {workspaceId && (
        <div className="flex items-center gap-2">
          <button onClick={selectAllForApproval} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
            {approvalSelected.size === filteredPages.length && filteredPages.length > 0 ? <CheckSquare className="w-3.5 h-3.5 text-teal-400" /> : <Square className="w-3.5 h-3.5" />}
            {approvalSelected.size === filteredPages.length && filteredPages.length > 0 ? 'Deselect all' : 'Select all for approval'}
          </button>
          {approvalSelected.size > 0 && <span className="text-xs text-teal-400">{approvalSelected.size} selected</span>}
        </div>
      )}

      {/* Page list */}
      <div className="space-y-2">
        {filteredPages.map(page => {
          const isExpanded = expanded.has(page.id);
          const edit = edits[page.id];
          const isSaving = saving.has(page.id);
          const isSaved = saved.has(page.id);
          const isAiLoading = aiLoading[page.id];
          const hasSeoTitle = !!(page.seo?.title);
          const hasSeoDesc = !!(page.seo?.description);
          const isSelected = approvalSelected.has(page.id);
          const pageRecs = recsLoaded ? recsForPage(page.slug) : [];
          const metaRecs = pageRecs.filter(r => r.type === 'metadata');
          const hasRecFlag = metaRecs.length > 0;
          const tracking = editTracking[page.id];
          const trackingBorder = tracking?.status === 'live' ? 'border-teal-500/50' : tracking?.status === 'in-review' ? 'border-purple-500/50' : tracking?.status === 'flagged' ? 'border-amber-500/50' : '';

          return (
            <div key={page.id} id={`seo-editor-page-${page.id}`} className={`bg-zinc-900 rounded-xl border overflow-hidden ${trackingBorder || (hasRecFlag ? 'border-amber-500/30' : isSelected ? 'border-teal-500/40 bg-teal-500/5' : 'border-zinc-800')}`}>
              <div className="flex items-center">
                {workspaceId && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleApprovalSelect(page.id); }}
                    className="pl-4 pr-1 py-3 text-zinc-500 hover:text-teal-400 transition-colors"
                  >
                    {isSelected ? <CheckSquare className="w-4 h-4 text-teal-400" /> : <Square className="w-4 h-4" />}
                  </button>
                )}
              <button
                onClick={() => toggleExpand(page.id)}
                className="flex-1 flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/50 transition-colors text-left"
              >
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-zinc-200 truncate">{page.title}</div>
                  <div className="text-xs text-zinc-500 truncate">/{page.slug}</div>
                </div>
                <div className="flex items-center gap-2">
                  {tracking?.status === 'live' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/30 text-teal-400">Live</span>}
                  {tracking?.status === 'in-review' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/30 text-purple-400">In Review</span>}
                  {tracking?.status === 'flagged' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">Flagged</span>}
                  {hasRecFlag && <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400"><AlertTriangle className="w-3 h-3" />{metaRecs.length} rec{metaRecs.length > 1 ? 's' : ''}</span>}
                  {!hasSeoTitle && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">No title</span>}
                  {!hasSeoDesc && <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400">No desc</span>}
                  {edit?.dirty && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400">Unsaved</span>}
                </div>
              </button>
              </div>

              {isExpanded && edit && (
                <div className="px-4 pb-4 space-y-3 bg-zinc-900/30">
                  {/* Recommendation banners */}
                  {metaRecs.map(rec => (
                    <div key={rec.id} className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-amber-300">{rec.title}</div>
                        <div className="text-[11px] text-zinc-400 mt-0.5">{rec.insight}</div>
                        {rec.trafficAtRisk > 0 && (
                          <div className="text-[11px] text-amber-400/70 mt-1">
                            {rec.trafficAtRisk.toLocaleString()} clicks at risk · {rec.estimatedGain}
                          </div>
                        )}
                      </div>
                      <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        rec.priority === 'fix_now' ? 'bg-red-500/15 text-red-400' :
                        rec.priority === 'fix_soon' ? 'bg-amber-500/15 text-amber-400' :
                        'bg-zinc-500/15 text-zinc-400'
                      }`}>
                        {rec.priority.replace('_', ' ')}
                      </span>
                    </div>
                  ))}
                  {/* SEO Title */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-zinc-400">SEO Title</label>
                      <div className="flex items-center gap-1">
                        <span className={`text-[11px] ${(edit.seoTitle.length > 60 || edit.seoTitle.length === 0) ? 'text-red-400' : edit.seoTitle.length > 50 ? 'text-amber-400' : 'text-green-400'}`}>
                          {edit.seoTitle.length}/60
                        </span>
                        <button
                          onClick={() => aiRewrite(page.id, 'title')}
                          disabled={!!isAiLoading}
                          className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] bg-teal-600/50 hover:bg-teal-500/50 rounded transition-colors disabled:opacity-50"
                          title="AI rewrite"
                        >
                          {isAiLoading === 'title' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
                          AI
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={edit.seoTitle}
                      onChange={e => updateField(page.id, 'seoTitle', e.target.value)}
                      placeholder="Enter SEO title..."
                      className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm focus:outline-none focus:border-zinc-500"
                    />
                    {variations[page.id]?.field === 'title' && variations[page.id].options.length > 1 && (
                      <div className="mt-1.5 space-y-1">
                        <div className="text-[11px] text-zinc-500 font-medium">Pick a variation:</div>
                        {variations[page.id].options.map((v, i) => (
                          <button
                            key={i}
                            onClick={() => { updateField(page.id, 'seoTitle', v); setVariations(prev => { const n = { ...prev }; delete n[page.id]; return n; }); }}
                            className={`w-full text-left px-3 py-1.5 rounded text-xs border transition-colors ${
                              edit.seoTitle === v
                                ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                                : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-300 hover:border-teal-500/30 hover:bg-teal-600/10'
                            }`}
                          >
                            <span className="text-zinc-500 mr-1.5">{i + 1}.</span>{v}
                            <span className={`ml-2 text-[10px] ${v.length > 60 ? 'text-red-400' : v.length > 50 ? 'text-amber-400' : 'text-green-400'}`}>{v.length}/60</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Meta Description */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-zinc-400">Meta Description</label>
                      <div className="flex items-center gap-1">
                        <span className={`text-[11px] ${(edit.seoDescription.length > 160 || edit.seoDescription.length === 0) ? 'text-red-400' : edit.seoDescription.length > 150 ? 'text-amber-400' : 'text-green-400'}`}>
                          {edit.seoDescription.length}/160
                        </span>
                        <button
                          onClick={() => aiRewrite(page.id, 'description')}
                          disabled={!!isAiLoading}
                          className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] bg-teal-600/50 hover:bg-teal-500/50 rounded transition-colors disabled:opacity-50"
                          title="AI rewrite"
                        >
                          {isAiLoading === 'description' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
                          AI
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={edit.seoDescription}
                      onChange={e => updateField(page.id, 'seoDescription', e.target.value)}
                      placeholder="Enter meta description..."
                      rows={2}
                      className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm focus:outline-none focus:border-zinc-500 resize-none"
                    />
                    {variations[page.id]?.field === 'description' && variations[page.id].options.length > 1 && (
                      <div className="mt-1.5 space-y-1">
                        <div className="text-[11px] text-zinc-500 font-medium">Pick a variation:</div>
                        {variations[page.id].options.map((v, i) => (
                          <button
                            key={i}
                            onClick={() => { updateField(page.id, 'seoDescription', v); setVariations(prev => { const n = { ...prev }; delete n[page.id]; return n; }); }}
                            className={`w-full text-left px-3 py-1.5 rounded text-xs border transition-colors ${
                              edit.seoDescription === v
                                ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                                : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-300 hover:border-teal-500/30 hover:bg-teal-600/10'
                            }`}
                          >
                            <span className="text-zinc-500 mr-1.5">{i + 1}.</span>{v}
                            <span className={`ml-2 text-[10px] ${v.length > 160 ? 'text-red-400' : v.length > 150 ? 'text-amber-400' : 'text-green-400'}`}>{v.length}/160</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Save button */}
                  <div className="flex justify-end">
                    <button
                      onClick={() => savePage(page.id)}
                      disabled={!edit.dirty || isSaving}
                      className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        isSaved ? 'bg-green-600 text-white' : 'bg-white text-black hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed'
                      }`}
                    >
                      {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : isSaved ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
                      {isSaved ? 'Saved!' : isSaving ? 'Saving...' : 'Save to Webflow'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
