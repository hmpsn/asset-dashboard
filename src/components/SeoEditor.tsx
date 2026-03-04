import { useState, useEffect } from 'react';
import {
  Loader2, Save, Sparkles, Upload, ChevronDown, ChevronRight,
  Check, AlertCircle, Wand2,
} from 'lucide-react';

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
  ogTitle: string;
  ogDescription: string;
  dirty: boolean;
}

interface Props {
  siteId: string;
}

export function SeoEditor({ siteId }: Props) {
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
          ogTitle: p.openGraph?.title || '',
          ogDescription: p.openGraph?.description || '',
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

  useEffect(() => { fetchPages(); }, [siteId]);

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
      await fetch(`/api/webflow/pages/${pageId}/seo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId,
          seo: { title: edit.seoTitle, description: edit.seoDescription },
          openGraph: { title: edit.ogTitle, description: edit.ogDescription },
        }),
      });
      setEdits(prev => ({ ...prev, [pageId]: { ...prev[pageId], dirty: false } }));
      setSaved(prev => new Set(prev).add(pageId));
      setTimeout(() => setSaved(prev => { const n = new Set(prev); n.delete(pageId); return n; }), 2000);
    } catch (err) {
      console.error('Save failed:', err);
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
        }),
      });
      const data = await res.json();
      if (data.text) {
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
          className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600/80 hover:bg-teal-500 disabled:opacity-40 rounded-lg text-xs font-medium transition-colors"
        >
          <Wand2 className="w-3 h-3" /> AI Fix Titles ({missingTitles})
        </button>
        <button
          onClick={() => handleBulkFix('description')}
          disabled={bulkFixing || missingDescs === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600/80 hover:bg-teal-500 disabled:opacity-40 rounded-lg text-xs font-medium transition-colors"
        >
          <Wand2 className="w-3 h-3" /> AI Fix Descriptions ({missingDescs})
        </button>
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

      {/* Page list */}
      <div className="space-y-1">
        {filteredPages.map(page => {
          const isExpanded = expanded.has(page.id);
          const edit = edits[page.id];
          const isSaving = saving.has(page.id);
          const isSaved = saved.has(page.id);
          const isAiLoading = aiLoading[page.id];
          const hasSeoTitle = !!(page.seo?.title);
          const hasSeoDesc = !!(page.seo?.description);

          return (
            <div key={page.id} className="rounded-lg border border-zinc-800 overflow-hidden">
              <button
                onClick={() => toggleExpand(page.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/50 transition-colors text-left"
              >
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-300 truncate">{page.title}</div>
                  <div className="text-xs text-zinc-600 truncate">/{page.slug}</div>
                </div>
                <div className="flex items-center gap-2">
                  {!hasSeoTitle && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">No title</span>}
                  {!hasSeoDesc && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400">No desc</span>}
                  {edit?.dirty && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400">Unsaved</span>}
                </div>
              </button>

              {isExpanded && edit && (
                <div className="px-4 pb-4 space-y-3 bg-zinc-900/30">
                  {/* SEO Title */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-zinc-400">SEO Title</label>
                      <div className="flex items-center gap-1">
                        <span className={`text-[10px] ${(edit.seoTitle.length > 60 || edit.seoTitle.length === 0) ? 'text-red-400' : edit.seoTitle.length > 50 ? 'text-amber-400' : 'text-green-400'}`}>
                          {edit.seoTitle.length}/60
                        </span>
                        <button
                          onClick={() => aiRewrite(page.id, 'title')}
                          disabled={!!isAiLoading}
                          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-teal-600/50 hover:bg-teal-500/50 rounded transition-colors disabled:opacity-40"
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
                  </div>

                  {/* Meta Description */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-zinc-400">Meta Description</label>
                      <div className="flex items-center gap-1">
                        <span className={`text-[10px] ${(edit.seoDescription.length > 160 || edit.seoDescription.length === 0) ? 'text-red-400' : edit.seoDescription.length > 150 ? 'text-amber-400' : 'text-green-400'}`}>
                          {edit.seoDescription.length}/160
                        </span>
                        <button
                          onClick={() => aiRewrite(page.id, 'description')}
                          disabled={!!isAiLoading}
                          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-teal-600/50 hover:bg-teal-500/50 rounded transition-colors disabled:opacity-40"
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
                  </div>

                  {/* OG Title */}
                  <div>
                    <label className="text-xs font-medium text-zinc-400 mb-1 block">OG Title</label>
                    <input
                      type="text"
                      value={edit.ogTitle}
                      onChange={e => updateField(page.id, 'ogTitle', e.target.value)}
                      placeholder="Open Graph title (for social sharing)..."
                      className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm focus:outline-none focus:border-zinc-500"
                    />
                  </div>

                  {/* OG Description */}
                  <div>
                    <label className="text-xs font-medium text-zinc-400 mb-1 block">OG Description</label>
                    <textarea
                      value={edit.ogDescription}
                      onChange={e => updateField(page.id, 'ogDescription', e.target.value)}
                      placeholder="Open Graph description (for social sharing)..."
                      rows={2}
                      className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm focus:outline-none focus:border-zinc-500 resize-none"
                    />
                  </div>

                  {/* Save button */}
                  <div className="flex justify-end">
                    <button
                      onClick={() => savePage(page.id)}
                      disabled={!edit.dirty || isSaving}
                      className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        isSaved ? 'bg-green-600 text-white' : 'bg-white text-black hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed'
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
