import { useState, useEffect, useRef } from 'react';
import { get, post, patch, del, getSafe } from '../api/client';
import {
  Loader2, Trash2, AlertTriangle, PenLine, Clipboard, Search, X, ArrowUpDown,
} from 'lucide-react';
import type { FixContext } from '../App';
import { PostEditor } from './PostEditor';
import { BriefGenerator } from './briefs/BriefGenerator';
import { RequestList } from './briefs/RequestList';
import { BriefList } from './briefs/BriefList';

interface ContentBrief {
  id: string;
  workspaceId: string;
  targetKeyword: string;
  secondaryKeywords: string[];
  suggestedTitle: string;
  suggestedMetaDesc: string;
  outline: { heading: string; notes: string; wordCount?: number; keywords?: string[] }[];
  wordCountTarget: number;
  intent: string;
  audience: string;
  competitorInsights: string;
  internalLinkSuggestions: string[];
  createdAt: string;
  executiveSummary?: string;
  contentFormat?: string;
  toneAndStyle?: string;
  peopleAlsoAsk?: string[];
  topicalEntities?: string[];
  serpAnalysis?: { contentType: string; avgWordCount: number; commonElements: string[]; gaps: string[] };
  difficultyScore?: number;
  trafficPotential?: string;
  ctaRecommendations?: string[];
  eeatGuidance?: { experience: string; expertise: string; authority: string; trust: string };
  contentChecklist?: string[];
  schemaRecommendations?: { type: string; notes: string }[];
  pageType?: string;
  referenceUrls?: string[];
  realPeopleAlsoAsk?: string[];
  realTopResults?: { position: number; title: string; url: string }[];
}

interface ContentTopicRequest {
  id: string;
  workspaceId: string;
  topic: string;
  targetKeyword: string;
  intent: string;
  priority: string;
  rationale: string;
  status: 'requested' | 'brief_generated' | 'client_review' | 'approved' | 'changes_requested' | 'in_progress' | 'delivered' | 'published' | 'declined';
  briefId?: string;
  clientNote?: string;
  internalNote?: string;
  declineReason?: string;
  clientFeedback?: string;
  source?: 'strategy' | 'client';
  serviceType?: 'brief_only' | 'full_post';
  upgradedAt?: string;
  deliveryUrl?: string;
  deliveryNotes?: string;
  targetPageId?: string;
  targetPageSlug?: string;
  comments?: { id: string; author: 'client' | 'team'; content: string; createdAt: string }[];
  requestedAt: string;
  updatedAt: string;
}

export function ContentBriefs({ workspaceId, onRequestCountChange, fixContext }: { workspaceId: string; onRequestCountChange?: (pending: number) => void; fixContext?: FixContext | null }) {
  const [briefs, setBriefs] = useState<ContentBrief[]>([]);
  const [clientRequests, setClientRequests] = useState<ContentTopicRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingBriefFor, setGeneratingBriefFor] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [businessCtx, setBusinessCtx] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [loadingBrief, setLoadingBrief] = useState<string | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [briefSearch, setBriefSearch] = useState('');

  // Auto-fill keyword from audit Fix→
  const fixConsumed = useRef(false);
  useEffect(() => {
    if (fixContext && !fixConsumed.current) {
      fixConsumed.current = true;
      const prefill = fixContext.pageName || fixContext.pageSlug || '';
      if (prefill) setKeyword(prefill.replace(/-/g, ' '));
    }
  }, [fixContext]);
  const [briefSort, setBriefSort] = useState<'date' | 'keyword' | 'difficulty'>('date');
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'brief' | 'request'; id: string; label: string } | null>(null);
  const [editingBrief, setEditingBrief] = useState<string | null>(null);
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [generatingPostFor, setGeneratingPostFor] = useState<string | null>(null);
  const [regeneratingBrief, setRegeneratingBrief] = useState<string | null>(null);
  interface PostSummary { id: string; briefId: string; targetKeyword: string; title: string; totalWordCount: number; status: string; createdAt: string; updatedAt: string }
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [deliveringReqId, setDeliveringReqId] = useState<string | null>(null);
  const [deliveryUrl, setDeliveryUrl] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [pageType, setPageType] = useState('');
  const [refUrls, setRefUrls] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleRegenerateBrief = async (briefId: string, feedback: string) => {
    setRegeneratingBrief(briefId);
    try {
      const newBrief = await post<ContentBrief>(`/api/content-briefs/${workspaceId}/${briefId}/regenerate`, { feedback });
      setBriefs(prev => [newBrief, ...prev]);
      setExpanded(newBrief.id);
    } catch { /* skip */ }
    setRegeneratingBrief(null);
  };

  const saveBriefField = async (briefId: string, updates: Partial<ContentBrief>) => {
    try {
      const updated = await patch<ContentBrief>(`/api/content-briefs/${workspaceId}/${briefId}`, updates);
      setBriefs(prev => prev.map(b => b.id === briefId ? updated : b));
    } catch { /* skip */ }
  };

  const getBriefById = (briefId: string) => briefs.find(b => b.id === briefId);

  const toggleRequestBrief = async (reqId: string, briefId: string) => {
    if (expandedRequest === reqId) { setExpandedRequest(null); setBriefError(null); return; }
    setBriefError(null);
    // If brief already in local state, just expand
    if (getBriefById(briefId)) { setExpandedRequest(reqId); return; }
    // Not in local state — try fetching individually
    setLoadingBrief(reqId);
    try {
      const url = `/api/content-briefs/${workspaceId}/${briefId}`;
      try {
        const brief = await get<ContentBrief>(url);
        setBriefs(prev => [brief, ...prev.filter(b => b.id !== brief.id)]);
        setLoadingBrief(null);
        setExpandedRequest(reqId);
        return;
      } catch {
        // Individual fetch failed — try refetching the full list as fallback
        try {
          const allBriefs = await getSafe<ContentBrief[]>(`/api/content-briefs/${workspaceId}`, []);
          if (Array.isArray(allBriefs)) {
            setBriefs(allBriefs);
            const found = allBriefs.find((b: ContentBrief) => b.id === briefId);
            if (found) {
              setLoadingBrief(null);
              setExpandedRequest(reqId);
              return;
            }
          }
        } catch { /* list fetch failed */ }
      }
      setBriefError(`Brief "${briefId}" not found. The brief may have been lost after a server restart. Try regenerating.`);
      setExpandedRequest(reqId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBriefError(`Network error loading brief: ${msg}`);
      setExpandedRequest(reqId);
    }
    setLoadingBrief(null);
  };

  const handleDeleteRequest = async (reqId: string) => {
    try {
      await del(`/api/content-requests/${workspaceId}/${reqId}`);
      setClientRequests(prev => {
        const next = prev.filter(r => r.id !== reqId);
        onRequestCountChange?.(next.filter(r => r.status === 'requested').length);
        return next;
      });
      if (expandedRequest === reqId) setExpandedRequest(null);
    } catch { /* skip */ }
  };

  const copyAsMarkdown = (b: ContentBrief) => {
    const lines: string[] = [
      `# Content Brief: ${b.targetKeyword}`,
      '',
      `**Write a ${b.wordCountTarget}-word ${b.contentFormat || 'article'} targeting "${b.targetKeyword}".**`,
      '',
    ];
    if (b.executiveSummary) lines.push(`## Strategic Context`, b.executiveSummary, '');
    lines.push(`## Title`, b.suggestedTitle, '', `## Meta Description`, b.suggestedMetaDesc, '');
    if (b.toneAndStyle) lines.push(`## Tone & Style`, b.toneAndStyle, '');
    lines.push(`## Target Audience`, b.audience, '');
    lines.push(`## Search Intent`, b.intent, '');
    if (b.secondaryKeywords.length) lines.push(`## Keywords to Include`, b.secondaryKeywords.map(k => `- ${k}`).join('\n'), '');
    if (b.topicalEntities?.length) lines.push(`## Topical Entities to Cover`, b.topicalEntities.map(e => `- ${e}`).join('\n'), '');
    if (b.peopleAlsoAsk?.length) lines.push(`## Questions to Answer`, b.peopleAlsoAsk.map((q, i) => `${i + 1}. ${q}`).join('\n'), '');
    if (b.outline.length) {
      lines.push(`## Content Outline`);
      b.outline.forEach(s => {
        lines.push(`### ${s.heading}${s.wordCount ? ` (~${s.wordCount} words)` : ''}`);
        lines.push(s.notes);
        if (s.keywords?.length) lines.push(`*Keywords: ${s.keywords.join(', ')}*`);
        lines.push('');
      });
    }
    if (b.ctaRecommendations?.length) lines.push(`## CTAs`, b.ctaRecommendations.map((c, i) => `- **${i === 0 ? 'Primary' : 'Secondary'}:** ${c}`).join('\n'), '');
    if (b.competitorInsights) lines.push(`## Competitor Insights`, b.competitorInsights, '');
    if (b.internalLinkSuggestions.length) lines.push(`## Internal Links to Include`, b.internalLinkSuggestions.map(l => `- /${l}`).join('\n'), '');
    if (b.serpAnalysis) {
      lines.push(`## SERP Analysis`);
      lines.push(`- Content type: ${b.serpAnalysis.contentType}`);
      lines.push(`- Avg word count: ${b.serpAnalysis.avgWordCount}`);
      if (b.serpAnalysis.gaps.length) lines.push(`- Gaps to exploit: ${b.serpAnalysis.gaps.join('; ')}`);
      lines.push('');
    }
    navigator.clipboard.writeText(lines.join('\n'));
  };

  const exportClientHTML = async (b: ContentBrief) => {
    // Open in new tab with print-ready branded view (has "Save as PDF" button)
    window.open(`/api/content-briefs/${workspaceId}/${b.id}/export`, '_blank');
  };

  const fetchPosts = () => {
    getSafe<PostSummary[]>(`/api/content-posts/${workspaceId}`, [])
      .then(r => { if (Array.isArray(r)) setPosts(r); })
      .catch(() => {});
  };

  useEffect(() => {
    let done = 0;
    const checkDone = () => { if (++done >= 2) setLoading(false); };

    getSafe<ContentBrief[]>(`/api/content-briefs/${workspaceId}`, [])
      .then(parsed => { if (Array.isArray(parsed)) setBriefs(parsed); })
      .catch(() => {})
      .finally(checkDone);

    getSafe<ContentTopicRequest[]>(`/api/content-requests/${workspaceId}`, [])
      .then(r => {
        if (Array.isArray(r)) {
          setClientRequests(r);
          onRequestCountChange?.(r.filter((req: ContentTopicRequest) => req.status === 'requested').length);
        }
      })
      .catch(() => {})
      .finally(checkDone);

    fetchPosts();
  }, [workspaceId]);

  const handleGenerateBriefForRequest = async (req: ContentTopicRequest) => {
    setGeneratingBriefFor(req.id);
    try {
      const brief = await post<ContentBrief>(`/api/content-requests/${workspaceId}/${req.id}/generate-brief`);
      setBriefs(prev => [brief, ...prev]);
      setClientRequests(prev => {
        const next = prev.map(r => r.id === req.id ? { ...r, status: 'brief_generated' as const, briefId: brief.id } : r);
        onRequestCountChange?.(next.filter(r => r.status === 'requested').length);
        return next;
      });
      setExpandedRequest(req.id);
    } catch { /* skip */ }
    setGeneratingBriefFor(null);
  };

  const handleGeneratePost = async (briefId: string) => {
    setGeneratingPostFor(briefId);
    try {
      const skeleton = await post<PostSummary>(`/api/content-posts/${workspaceId}/generate`, { briefId });
      setPosts(prev => [skeleton, ...prev]);
      setActivePostId(skeleton.id);
    } catch { /* skip */ }
    setGeneratingPostFor(null);
  };

  const handleUpdateRequestStatus = async (reqId: string, status: ContentTopicRequest['status'], extra?: { deliveryUrl?: string; deliveryNotes?: string }) => {
    try {
      const updated = await patch<ContentTopicRequest>(`/api/content-requests/${workspaceId}/${reqId}`, { status, ...extra });
      setClientRequests(prev => {
        const next = prev.map(r => r.id === reqId ? updated : r);
        onRequestCountChange?.(next.filter(r => r.status === 'requested').length);
        return next;
      });
    } catch { /* skip */ }
  };

  const handleGenerate = async () => {
    if (!keyword.trim()) return;
    setGenerating(true);
    setError('');
    try {
      const brief = await post<ContentBrief>(`/api/content-briefs/${workspaceId}/generate`, {
        targetKeyword: keyword.trim(),
        businessContext: businessCtx.trim() || undefined,
        targetPageId: fixContext?.pageId,
        targetPageSlug: fixContext?.pageSlug,
        pageType: pageType || undefined,
        referenceUrls: refUrls.trim() ? refUrls.split('\n').map(u => u.trim()).filter(u => u.startsWith('http')) : undefined,
      });
      setBriefs(prev => [brief, ...prev]);
      setKeyword('');
      setExpanded(brief.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate brief');
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (briefId: string) => {
    await del(`/api/content-briefs/${workspaceId}/${briefId}`);
    setBriefs(prev => prev.filter(b => b.id !== briefId));
    if (expanded === briefId) setExpanded(null);
    setDeleteConfirm(null);
  };

  const confirmDeleteBrief = (brief: ContentBrief) => {
    setDeleteConfirm({ type: 'brief', id: brief.id, label: brief.targetKeyword });
  };

  const confirmDeleteRequest = (req: ContentTopicRequest) => {
    setDeleteConfirm({ type: 'request', id: req.id, label: req.topic });
  };

  const executeDelete = async () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === 'brief') {
      await handleDelete(deleteConfirm.id);
    } else {
      await handleDeleteRequest(deleteConfirm.id);
    }
    setDeleteConfirm(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-zinc-200">Delete {deleteConfirm.type === 'brief' ? 'Brief' : 'Request'}?</div>
                <div className="text-xs text-zinc-500 mt-0.5">This action cannot be undone</div>
              </div>
            </div>
            <div className="text-xs text-zinc-400 mb-4 pl-[52px]">
              <span className="text-zinc-300 font-medium">&ldquo;{deleteConfirm.label}&rdquo;</span> will be permanently removed.
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors">Cancel</button>
              <button onClick={executeDelete} className="px-4 py-2 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-500 transition-colors flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Post Editor */}
      {activePostId && (
        <div className="bg-zinc-900 rounded-xl border border-blue-500/20 p-4">
          <PostEditor
            workspaceId={workspaceId}
            postId={activePostId}
            onClose={() => setActivePostId(null)}
            onDelete={() => { fetchPosts(); setActivePostId(null); }}
          />
        </div>
      )}

      {/* Generated Posts list */}
      {posts.length > 0 && !activePostId && (
        <div className="bg-zinc-900 rounded-xl border border-blue-500/20 p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <PenLine className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-medium text-zinc-300">Generated Posts</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">{posts.length}</span>
          </div>
          <div className="space-y-2">
            {posts.map(post => {
              const statusColors: Record<string, string> = {
                generating: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
                draft: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
                review: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
                approved: 'text-green-400 bg-green-500/10 border-green-500/20',
              };
              return (
                <button
                  key={post.id}
                  onClick={() => setActivePostId(post.id)}
                  className="w-full text-left rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2.5 hover:border-blue-500/30 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-zinc-200 truncate">{post.title}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">"{post.targetKeyword}" · {post.totalWordCount.toLocaleString()} words</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded border font-medium ${statusColors[post.status] || statusColors.draft}`}>
                        {post.status === 'generating' ? 'Generating...' : post.status.charAt(0).toUpperCase() + post.status.slice(1)}
                      </span>
                      <span className="text-[11px] text-zinc-600">{new Date(post.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Client Requests */}
      <RequestList
        clientRequests={clientRequests}
        expandedRequest={expandedRequest}
        generatingBriefFor={generatingBriefFor}
        loadingBrief={loadingBrief}
        briefError={briefError}
        deliveringReqId={deliveringReqId}
        deliveryUrl={deliveryUrl}
        deliveryNotes={deliveryNotes}
        getBriefById={getBriefById}
        onToggleRequestBrief={toggleRequestBrief}
        onGenerateBriefForRequest={handleGenerateBriefForRequest}
        onUpdateRequestStatus={handleUpdateRequestStatus}
        onConfirmDeleteRequest={confirmDeleteRequest}
        onSetDeliveringReqId={setDeliveringReqId}
        onSetDeliveryUrl={setDeliveryUrl}
        onSetDeliveryNotes={setDeliveryNotes}
        onSetBriefError={setBriefError}
        onSetExpandedRequest={setExpandedRequest}
        onCopyAsMarkdown={copyAsMarkdown}
        onExportClientHTML={exportClientHTML}
      />

      {/* Content Briefs header — search/sort controls */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clipboard className="w-5 h-5 text-teal-400" />
            <h2 className="text-sm font-semibold text-zinc-200">Content Briefs</h2>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{briefs.length} total</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={briefSearch}
                onChange={e => setBriefSearch(e.target.value)}
                placeholder="Search briefs..."
                className="w-48 pl-8 pr-7 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 focus:border-zinc-700 focus:outline-none"
              />
              {briefSearch && (
                <button onClick={() => setBriefSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-400">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-zinc-500">
              <ArrowUpDown className="w-3 h-3" />
              <select value={briefSort} onChange={e => setBriefSort(e.target.value as 'date' | 'keyword' | 'difficulty')} className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-[11px] text-zinc-400 focus:outline-none cursor-pointer">
                <option value="date">Newest</option>
                <option value="keyword">Keyword A-Z</option>
                <option value="difficulty">Difficulty</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Generator */}
      <BriefGenerator
        workspaceId={workspaceId}
        keyword={keyword}
        businessCtx={businessCtx}
        pageType={pageType}
        refUrls={refUrls}
        showAdvanced={showAdvanced}
        generating={generating}
        error={error}
        onKeywordChange={setKeyword}
        onBusinessCtxChange={setBusinessCtx}
        onPageTypeChange={setPageType}
        onRefUrlsChange={setRefUrls}
        onToggleAdvanced={() => setShowAdvanced(v => !v)}
        onGenerate={handleGenerate}
      />

      {/* Briefs list (standalone — not linked to a request) */}
      <BriefList
        briefs={briefs}
        clientRequests={clientRequests}
        expanded={expanded}
        briefSearch={briefSearch}
        briefSort={briefSort}
        editingBrief={editingBrief}
        generatingPostFor={generatingPostFor}
        regeneratingBrief={regeneratingBrief}
        onSetExpanded={setExpanded}
        onSetBriefSearch={setBriefSearch}
        onSetBriefSort={setBriefSort}
        onSetEditingBrief={setEditingBrief}
        onSaveBriefField={saveBriefField}
        onGeneratePost={handleGeneratePost}
        onRegenerate={handleRegenerateBrief}
        onCopyAsMarkdown={copyAsMarkdown}
        onExportClientHTML={exportClientHTML}
        onConfirmDeleteBrief={confirmDeleteBrief}
      />
    </div>
  );
}
