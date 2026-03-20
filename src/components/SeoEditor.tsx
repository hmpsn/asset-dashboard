import { useState, useEffect, useRef } from 'react';
import { get, put, post } from '../api/client';
import {
  Loader2, Upload, ChevronDown, ChevronRight,
  Check, AlertCircle, Wand2, AlertTriangle,
} from 'lucide-react';
import type { FixContext } from '../App';
import { useRecommendations } from '../hooks/useRecommendations';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { StatusBadge } from './ui/StatusBadge';
import { PageEditRow } from './editor/PageEditRow';
import { BulkOperations } from './editor/BulkOperations';
import { ApprovalPanel } from './editor/ApprovalPanel';
import { PendingApprovals } from './PendingApprovals';

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
  const [approvalRefreshKey, setApprovalRefreshKey] = useState(0);
  const [sendingPage, setSendingPage] = useState<Set<string>>(new Set());
  const [sentPage, setSentPage] = useState<Set<string>>(new Set());
  const [variations, setVariations] = useState<Record<string, { field: string; options: string[] }>>({});
  const { getState, refresh: refreshStates, summary } = usePageEditStates(workspaceId);

  // Bulk operations state
  const [bulkMode, setBulkMode] = useState<'idle' | 'pattern' | 'rewrite-preview' | 'rewriting'>('idle');
  const [bulkField, setBulkField] = useState<'title' | 'description'>('title');
  const [patternAction, setPatternAction] = useState<'append' | 'prepend'>('append');
  const [patternText, setPatternText] = useState('');
  const [bulkPreview, setBulkPreview] = useState<Array<{ pageId: string; oldValue: string; newValue: string }>>([]);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [bulkSource, setBulkSource] = useState<'pattern' | 'ai'>('pattern');

  const fetchPages = async () => {
    setLoading(true);
    try {
      const data = await get<PageMeta[]>(`/api/webflow/pages/${siteId}`);
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
      const data = await put<{ success?: boolean; error?: string }>(`/api/webflow/pages/${pageId}/seo`, {
        siteId,
        seo: { title: edit.seoTitle, description: edit.seoDescription },
        openGraph: { title: edit.seoTitle, description: edit.seoDescription },
      });
      if (data.success === false) {
        console.error('Save failed:', data.error);
        alert(`Failed to save SEO: ${data.error || 'Unknown error'}`);
        return;
      }
      setEdits(prev => ({ ...prev, [pageId]: { ...prev[pageId], dirty: false } }));
      setSaved(prev => new Set(prev).add(pageId));
      // Refresh page edit states to reflect the new 'live' status
      refreshStates();
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
      const data = await post<{ text?: string; variations?: string[] }>('/api/webflow/seo-rewrite', {
        pageTitle: page.title,
        currentSeoTitle: edit?.seoTitle || page.seo?.title,
        currentDescription: edit?.seoDescription || page.seo?.description,
        field,
        workspaceId,
        pagePath: `/${page.slug || ''}`,
      });
      if (data.variations && data.variations.length > 1) {
        // Show variation picker — auto-select the first one
        const key = field === 'title' ? 'seoTitle' : 'seoDescription';
        updateField(pageId, key, data.variations[0]);
        setVariations(prev => ({ ...prev, [pageId]: { field, options: data.variations! } }));
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
      const data = await post<{ success?: boolean }>(`/api/webflow/publish/${siteId}`);
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
      const data = await post<{ results?: Array<{ applied: boolean }> }>(`/api/webflow/seo-bulk-fix/${siteId}`, {
        field,
        pages: pagesNeedingFix.map(p => ({
          pageId: p.id,
          title: p.title,
          currentSeoTitle: p.seo?.title,
          currentDescription: p.seo?.description,
        })),
      });
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

  // ── Bulk Pattern Apply ──
  const previewPattern = () => {
    if (!patternText.trim()) return;
    const maxLen = bulkField === 'description' ? 160 : 60;
    const preview = Array.from(approvalSelected).map(pageId => {
      const page = pages.find(p => p.id === pageId);
      const edit = edits[pageId];
      if (!page || !edit) return null;
      const oldValue = bulkField === 'title' ? (edit.seoTitle || page.seo?.title || '') : (edit.seoDescription || page.seo?.description || '');
      let newValue = patternAction === 'append' ? `${oldValue} ${patternText}`.trim() : `${patternText} ${oldValue}`.trim();
      if (newValue.length > maxLen) newValue = newValue.slice(0, maxLen).replace(/\s+\S*$/, '');
      return { pageId, oldValue, newValue };
    }).filter(Boolean) as Array<{ pageId: string; oldValue: string; newValue: string }>;
    setBulkPreview(preview);
    setBulkSource('pattern');
    setBulkMode('rewrite-preview');
  };

  const applyPattern = async () => {
    setBulkMode('rewriting');
    setBulkProgress({ done: 0, total: bulkPreview.length });
    try {
      const pagesPayload = bulkPreview.map(p => {
        const page = pages.find(pg => pg.id === p.pageId);
        return { pageId: p.pageId, title: page?.title || '', slug: page?.slug, currentValue: p.oldValue };
      });
      const data = await post<{ results: Array<{ pageId: string; newValue: string; applied: boolean }> }>(
        `/api/webflow/seo-pattern-apply/${siteId}`,
        { pages: pagesPayload, field: bulkField, action: patternAction, text: patternText }
      );
      const applied = data.results?.filter(r => r.applied).length || 0;
      setBulkResults(`Pattern applied to ${applied}/${bulkPreview.length} pages.`);
      fetchPages();
    } catch { setBulkResults('Pattern apply failed.'); }
    finally { setBulkMode('idle'); setBulkPreview([]); setPatternText(''); setTimeout(() => setBulkResults(null), 5000); }
  };

  // ── Bulk AI Rewrite ──
  const bulkAiRewrite = async (field: 'title' | 'description', dryRun: boolean) => {
    const selectedPages = Array.from(approvalSelected).map(id => pages.find(p => p.id === id)).filter(Boolean) as PageMeta[];
    if (selectedPages.length === 0) return;
    setBulkField(field);
    if (dryRun) setBulkMode('rewriting');
    setBulkProgress({ done: 0, total: selectedPages.length });
    try {
      const pagesPayload = selectedPages.map(p => ({
        pageId: p.id, title: p.title, slug: p.slug,
        currentSeoTitle: edits[p.id]?.seoTitle || p.seo?.title,
        currentDescription: edits[p.id]?.seoDescription || p.seo?.description,
      }));
      const data = await post<{ results: Array<{ pageId: string; oldValue: string; newValue: string; applied: boolean }> }>(
        `/api/webflow/seo-bulk-rewrite/${siteId}`,
        { pages: pagesPayload, field, workspaceId, dryRun }
      );
      if (dryRun) {
        setBulkPreview(data.results?.filter(r => r.newValue) || []);
        setBulkSource('ai');
        setBulkMode('rewrite-preview');
      } else {
        const applied = data.results?.filter(r => r.applied).length || 0;
        setBulkResults(`AI rewrote ${applied}/${selectedPages.length} ${field === 'title' ? 'titles' : 'descriptions'}.`);
        fetchPages();
        setBulkMode('idle');
        setTimeout(() => setBulkResults(null), 5000);
      }
    } catch { setBulkResults('Bulk rewrite failed.'); setBulkMode('idle'); setTimeout(() => setBulkResults(null), 5000); }
  };

  const applyBulkRewrite = async () => {
    setBulkMode('rewriting');
    setBulkProgress({ done: 0, total: bulkPreview.length });
    try {
      // Push each previewed value directly to Webflow
      for (const item of bulkPreview) {
        const page = pages.find(pg => pg.id === item.pageId);
        if (!page) continue;
        const seoFields = bulkField === 'title'
          ? { seo: { title: item.newValue, description: edits[page.id]?.seoDescription || page.seo?.description || '' } }
          : { seo: { title: edits[page.id]?.seoTitle || page.seo?.title || '', description: item.newValue } };
        await put(`/api/webflow/pages/${page.id}/seo`, { siteId, ...seoFields, openGraph: seoFields.seo });
        setBulkProgress(prev => ({ ...prev, done: prev.done + 1 }));
      }
      setBulkResults(`Applied ${bulkPreview.length} ${bulkField === 'title' ? 'title' : 'description'} changes.`);
      fetchPages();
    } catch { setBulkResults('Apply failed.'); }
    finally { setBulkMode('idle'); setBulkPreview([]); setTimeout(() => setBulkResults(null), 5000); }
  };

  const sendPageToClient = async (pageId: string) => {
    if (!workspaceId) return;
    const page = pages.find(p => p.id === pageId);
    const edit = edits[pageId];
    if (!page || !edit) return;
    const items: Array<{ pageId: string; pageTitle: string; pageSlug: string; field: 'seoTitle' | 'seoDescription'; currentValue: string; proposedValue: string }> = [];
    if (edit.seoTitle !== (page.seo?.title || '')) {
      items.push({ pageId, pageTitle: page.title, pageSlug: page.slug, field: 'seoTitle', currentValue: page.seo?.title || '', proposedValue: edit.seoTitle });
    }
    if (edit.seoDescription !== (page.seo?.description || '')) {
      items.push({ pageId, pageTitle: page.title, pageSlug: page.slug, field: 'seoDescription', currentValue: page.seo?.description || '', proposedValue: edit.seoDescription });
    }
    if (items.length === 0) return;
    setSendingPage(prev => new Set(prev).add(pageId));
    try {
      await post(`/api/approvals/${workspaceId}`, { siteId, name: `SEO Review — ${page.title}`, items });
      setSentPage(prev => new Set(prev).add(pageId));
      refreshStates();
      setTimeout(() => setSentPage(prev => { const n = new Set(prev); n.delete(pageId); return n; }), 4000);
    } catch { /* skip */ }
    setSendingPage(prev => { const n = new Set(prev); n.delete(pageId); return n; });
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
      await post(`/api/approvals/${workspaceId}`, { siteId, name: `SEO Changes — ${new Date().toLocaleDateString()}`, items });
      setApprovalSent(true);
      // Refresh page edit states to reflect the new 'in-review' status
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
          <ApprovalPanel
            approvalSelected={approvalSelected}
            sendingApproval={sendingApproval}
            approvalSent={approvalSent}
            onSendApproval={sendForApproval}
          />
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

      {/* Pending approval batches sent to client */}
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
          {summary.live > 0 && <StatusBadge status="live" />}
          {summary.live > 0 && <span className="text-teal-400">{summary.live}</span>}
          {summary.inReview > 0 && <StatusBadge status="in-review" />}
          {summary.inReview > 0 && <span className="text-purple-400">{summary.inReview}</span>}
          {summary.approved > 0 && <StatusBadge status="approved" />}
          {summary.approved > 0 && <span className="text-green-400">{summary.approved}</span>}
          {summary.rejected > 0 && <StatusBadge status="rejected" />}
          {summary.rejected > 0 && <span className="text-red-400">{summary.rejected}</span>}
          {summary.issueDetected > 0 && <StatusBadge status="issue-detected" />}
          {summary.issueDetected > 0 && <span className="text-amber-400">{summary.issueDetected}</span>}
          {summary.fixProposed > 0 && <StatusBadge status="fix-proposed" />}
          {summary.fixProposed > 0 && <span className="text-blue-400">{summary.fixProposed}</span>}
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

      <BulkOperations
        filteredPages={filteredPages} approvalSelected={approvalSelected}
        bulkMode={bulkMode} bulkField={bulkField} patternAction={patternAction}
        patternText={patternText} bulkPreview={bulkPreview} bulkProgress={bulkProgress}
        bulkSource={bulkSource} pages={pages}
        onSelectAll={selectAllForApproval} onSetBulkField={setBulkField}
        onSetBulkMode={setBulkMode} onSetPatternAction={setPatternAction}
        onSetPatternText={setPatternText} onPreviewPattern={previewPattern}
        onApplyPattern={applyPattern} onApplyBulkRewrite={applyBulkRewrite}
        onBulkAiRewrite={bulkAiRewrite}
        onClearPreview={() => { setBulkMode('idle'); setBulkPreview([]); }}
      />

      {/* Page list */}
      <div className="space-y-2">
        {filteredPages.map(page => (
          <PageEditRow
            key={page.id} page={page} edit={edits[page.id]}
            expanded={expanded.has(page.id)} isSaving={saving.has(page.id)}
            isSaved={saved.has(page.id)} isAiLoading={aiLoading[page.id]}
            isSelected={approvalSelected.has(page.id)}
            pageRecs={recsLoaded ? recsForPage(page.slug) : []}
            pageState={getState(page.id)} variations={variations[page.id]}
            showApprovalCheckbox={!!workspaceId}
            isSendingToClient={sendingPage.has(page.id)}
            isSentToClient={sentPage.has(page.id)}
            hasChanges={!!(edits[page.id] && (edits[page.id].seoTitle !== (page.seo?.title || '') || edits[page.id].seoDescription !== (page.seo?.description || '')))}
            onSendToClient={sendPageToClient}
            onToggleExpand={toggleExpand} onToggleApprovalSelect={toggleApprovalSelect}
            onUpdateField={updateField} onSave={savePage} onAiRewrite={aiRewrite}
            onSelectVariation={(pageId, field, value) => updateField(pageId, field, value)}
            onClearVariations={(pageId) => setVariations(prev => { const n = { ...prev }; delete n[pageId]; return n; })}
          />
        ))}
      </div>
    </div>
  );
}
