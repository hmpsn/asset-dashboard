import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { get, post, patch, del, getSafe } from '../api/client';
import {
  Loader2, Trash2, AlertTriangle, PenLine, Clipboard, Search, X, ArrowUpDown,
} from 'lucide-react';
import type { FixContext } from '../App';
import { PostEditor } from './PostEditor';
import { BriefGenerator } from './briefs/BriefGenerator';
import { RequestList } from './briefs/RequestList';
import { BriefList } from './briefs/BriefList';
import { useAdminBriefsList, useAdminRequestsList, useAdminPostsList } from '../hooks/admin';

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
  titleVariants?: string[];
  metaDescVariants?: string[];
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

/** targetRoute values that ContentBriefs recognises as legitimate brief-generation navigations.
 *  Any fixContext without one of these routes is treated as stale (e.g. from seo-editor). */
const BRIEF_ROUTES = ['seo-briefs', 'content-pipeline'] as const;
type BriefRoute = typeof BRIEF_ROUTES[number];

export function ContentBriefs({ workspaceId, onRequestCountChange, fixContext }: { workspaceId: string; onRequestCountChange?: (pending: number) => void; fixContext?: FixContext | null }) {
  const queryClient = useQueryClient();
  const briefsQ = useAdminBriefsList(workspaceId);
  const requestsQ = useAdminRequestsList(workspaceId);
  const postsQ = useAdminPostsList(workspaceId);
  interface PostSummary { id: string; briefId: string; targetKeyword: string; title: string; totalWordCount: number; status: string; createdAt: string; updatedAt: string }
  const briefs = (briefsQ.data ?? []) as ContentBrief[];
  const clientRequests = (requestsQ.data ?? []) as ContentTopicRequest[];
  const posts = (postsQ.data ?? []) as PostSummary[];
  const loading = briefsQ.isLoading || requestsQ.isLoading;

  // Notify parent of pending request count whenever requests data changes
  useEffect(() => {
    onRequestCountChange?.(clientRequests.filter(r => r.status === 'requested').length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientRequests]);

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

  // Capture fixContext in a ref so handleGenerate can use it even after the parent clears it.
  // Only capture when the targetRoute confirms this fixContext is intended for brief generation.
  const fixContextRef = useRef<FixContext | null | undefined>(fixContext);
  useEffect(() => {
    if (fixContext && BRIEF_ROUTES.includes(fixContext.targetRoute as BriefRoute)) {
      fixContextRef.current = fixContext;
    }
  }, [fixContext]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill keyword from Page Intelligence context and optionally auto-generate.
  // Guard on targetRoute so stale fixContext from seo-editor/seo-schema navigations
  // doesn't pre-fill the keyword field when ContentBriefs mounts at an unrelated tab.
  const fixConsumed = useRef(false);
  useEffect(() => {
    if (fixContext && !fixConsumed.current && BRIEF_ROUTES.includes(fixContext.targetRoute as BriefRoute)) {
      fixConsumed.current = true;
      // Prefer the actual primary keyword over page name
      const prefill = fixContext.primaryKeyword || fixContext.pageName || fixContext.pageSlug || '';
      if (prefill) setKeyword(prefill.replace(/-/g, ' '));
    }
  }, [fixContext]);

  // Auto-generate when arriving from Page Intelligence with autoGenerate flag
  const autoGenTriggered = useRef(false);
  useEffect(() => {
    if (fixContextRef.current?.autoGenerate && !autoGenTriggered.current && keyword.trim() && !generating) {
      autoGenTriggered.current = true;
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);
  const [briefSort, setBriefSort] = useState<'date' | 'keyword' | 'difficulty'>('date');
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'brief' | 'request'; id: string; label: string } | null>(null);
  const [editingBrief, setEditingBrief] = useState<string | null>(null);
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [generatingPostFor, setGeneratingPostFor] = useState<string | null>(null);
  const [regeneratingBrief, setRegeneratingBrief] = useState<string | null>(null);
  const [regeneratingOutline, setRegeneratingOutline] = useState<string | null>(null);
  const [sendingToClient, setSendingToClient] = useState<string | null>(null);
  const [deliveringReqId, setDeliveringReqId] = useState<string | null>(null);
  const [deliveryUrl, setDeliveryUrl] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [pageType, setPageType] = useState('');
  const [refUrls, setRefUrls] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleRegenerateOutline = async (briefId: string, feedback?: string) => {
    setRegeneratingOutline(briefId);
    try {
      const updated = await post<ContentBrief>(`/api/content-briefs/${workspaceId}/${briefId}/regenerate-outline`, { feedback });
      queryClient.setQueryData<ContentBrief[]>(['admin-briefs', workspaceId], old => (old ?? []).map(b => b.id === briefId ? updated : b));
    } catch (err) { console.error('ContentBriefs operation failed:', err); }
    setRegeneratingOutline(null);
  };

  const handleRegenerateBrief = async (briefId: string, feedback: string) => {
    setRegeneratingBrief(briefId);
    try {
      const newBrief = await post<ContentBrief>(`/api/content-briefs/${workspaceId}/${briefId}/regenerate`, { feedback });
      queryClient.setQueryData<ContentBrief[]>(['admin-briefs', workspaceId], old => [newBrief, ...(old ?? [])]);
      setExpanded(newBrief.id);
    } catch (err) { console.error('ContentBriefs operation failed:', err); }
    setRegeneratingBrief(null);
  };

  const saveBriefField = async (briefId: string, updates: Partial<ContentBrief>) => {
    try {
      const updated = await patch<ContentBrief>(`/api/content-briefs/${workspaceId}/${briefId}`, updates);
      queryClient.setQueryData<ContentBrief[]>(['admin-briefs', workspaceId], old => (old ?? []).map(b => b.id === briefId ? updated : b));
    } catch (err) { console.error('ContentBriefs operation failed:', err); }
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
        queryClient.setQueryData<ContentBrief[]>(['admin-briefs', workspaceId], old => [brief, ...(old ?? []).filter(b => b.id !== brief.id)]);
        setLoadingBrief(null);
        setExpandedRequest(reqId);
        return;
      } catch (err) {
      console.error('ContentBriefs operation failed:', err);
        // Individual fetch failed — try refetching the full list as fallback
        try {
          const allBriefs = await getSafe<ContentBrief[]>(`/api/content-briefs/${workspaceId}`, []);
          if (Array.isArray(allBriefs)) {
            queryClient.setQueryData<ContentBrief[]>(['admin-briefs', workspaceId], allBriefs);
            const found = allBriefs.find((b: ContentBrief) => b.id === briefId);
            if (found) {
              setLoadingBrief(null);
              setExpandedRequest(reqId);
              return;
            }
          }
        } catch (err) { console.error('ContentBriefs operation failed:', err); }
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
      queryClient.setQueryData<ContentTopicRequest[]>(['admin-requests', workspaceId], old => (old ?? []).filter(r => r.id !== reqId));
      if (expandedRequest === reqId) setExpandedRequest(null);
    } catch (err) { console.error('ContentBriefs operation failed:', err); }
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

  const exportClientHTML = (b: ContentBrief) => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write('<p style="font-family:sans-serif;padding:40px">Loading PDF preview…</p>');
    fetch(`/api/content-briefs/${workspaceId}/${b.id}/export`)
      .then(r => r.text())
      .then(html => { w.document.open(); w.document.write(html); w.document.close(); })
      .catch(() => { w.location.href = `/api/content-briefs/${workspaceId}/${b.id}/export`; });
  };

  const handleSendToClient = async (b: ContentBrief) => {
    setSendingToClient(b.id);
    try {
      const result = await post<{ ok: boolean; requestId: string }>(`/api/content-briefs/${workspaceId}/${b.id}/send-to-client`);
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ['admin-requests', workspaceId] });
      }
    } catch (err) { console.error('ContentBriefs operation failed:', err); }
    setSendingToClient(null);
  };


  const handleGenerateBriefForRequest = async (req: ContentTopicRequest) => {
    setGeneratingBriefFor(req.id);
    try {
      const brief = await post<ContentBrief>(`/api/content-requests/${workspaceId}/${req.id}/generate-brief`);
      queryClient.setQueryData<ContentBrief[]>(['admin-briefs', workspaceId], old => [brief, ...(old ?? [])]);
      queryClient.setQueryData<ContentTopicRequest[]>(['admin-requests', workspaceId], old => (old ?? []).map(r => r.id === req.id ? { ...r, status: 'brief_generated' as const, briefId: brief.id } : r));
      setExpandedRequest(req.id);
    } catch (err) { console.error('ContentBriefs operation failed:', err); }
    setGeneratingBriefFor(null);
  };

  const handleGeneratePost = async (briefId: string) => {
    setGeneratingPostFor(briefId);
    try {
      const skeleton = await post<PostSummary>(`/api/content-posts/${workspaceId}/generate`, { briefId });
      queryClient.setQueryData(['admin-posts', workspaceId], (old: unknown) => [skeleton, ...(Array.isArray(old) ? old : [])]);
      setActivePostId(skeleton.id);
    } catch (err) { console.error('ContentBriefs operation failed:', err); }
    setGeneratingPostFor(null);
  };

  const handleUpdateRequestStatus = async (reqId: string, status: ContentTopicRequest['status'], extra?: { deliveryUrl?: string; deliveryNotes?: string }) => {
    try {
      const updated = await patch<ContentTopicRequest>(`/api/content-requests/${workspaceId}/${reqId}`, { status, ...extra });
      queryClient.setQueryData<ContentTopicRequest[]>(['admin-requests', workspaceId], old => (old ?? []).map(r => r.id === reqId ? updated : r));
    } catch (err) { console.error('ContentBriefs operation failed:', err); }
  };

  const handleGenerate = async () => {
    if (!keyword.trim()) return;
    setGenerating(true);
    setError('');
    try {
      const brief = await post<ContentBrief>(`/api/content-briefs/${workspaceId}/generate`, {
        targetKeyword: keyword.trim(),
        businessContext: businessCtx.trim() || undefined,
        targetPageId: fixContextRef.current?.pageId,
        targetPageSlug: fixContextRef.current?.pageSlug,
        pageType: pageType || undefined,
        referenceUrls: refUrls.trim() ? refUrls.split('\n').map(u => u.trim()).filter(u => u.startsWith('http')) : undefined,
        pageAnalysisContext: fixContextRef.current?.optimizationIssues || fixContextRef.current?.recommendations || fixContextRef.current?.contentGaps
          ? {
              optimizationScore: fixContextRef.current.optimizationScore,
              optimizationIssues: fixContextRef.current.optimizationIssues,
              recommendations: fixContextRef.current.recommendations,
              contentGaps: fixContextRef.current.contentGaps,
              searchIntent: fixContextRef.current.searchIntent,
            }
          : undefined,
      });
      queryClient.setQueryData<ContentBrief[]>(['admin-briefs', workspaceId], old => [brief, ...(old ?? [])]);
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
    queryClient.setQueryData<ContentBrief[]>(['admin-briefs', workspaceId], old => (old ?? []).filter(b => b.id !== briefId));
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
    <div className="space-y-8">
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
        <div className="bg-zinc-900 border border-blue-500/20 p-4" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <PostEditor
            workspaceId={workspaceId}
            postId={activePostId}
            onClose={() => setActivePostId(null)}
            onDelete={() => { queryClient.invalidateQueries({ queryKey: ['admin-posts', workspaceId] }); setActivePostId(null); }}
          />
        </div>
      )}

      {/* Generated Posts list */}
      {posts.length > 0 && !activePostId && (
        <div className="bg-zinc-900 border border-blue-500/20 p-4 space-y-3" style={{ borderRadius: '10px 24px 10px 24px' }}>
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
        clientRequests={clientRequests as any}
        expanded={expanded}
        briefSearch={briefSearch}
        briefSort={briefSort}
        editingBrief={editingBrief}
        generatingPostFor={generatingPostFor}
        regeneratingBrief={regeneratingBrief}
        sendingToClient={sendingToClient}
        onSetExpanded={setExpanded}
        onSetBriefSearch={setBriefSearch}
        onSetBriefSort={setBriefSort}
        onSetEditingBrief={setEditingBrief}
        onSaveBriefField={saveBriefField}
        onGeneratePost={handleGeneratePost}
        onRegenerateBrief={handleRegenerateBrief}
        onCopyAsMarkdown={copyAsMarkdown}
        onExportClientHTML={exportClientHTML}
        onSendToClient={handleSendToClient}
        onConfirmDeleteBrief={confirmDeleteBrief}
        onRegenerateOutline={handleRegenerateOutline}
        regeneratingOutline={regeneratingOutline}
      />
    </div>
  );
}
