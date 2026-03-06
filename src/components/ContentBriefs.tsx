import { useState, useEffect } from 'react';
import {
  Loader2, Clipboard, Trash2, ChevronDown, ChevronUp, Sparkles, FileText,
  Inbox, CheckCircle2, XCircle, Clock, Zap, Download, Copy, Search,
  Target, MessageSquare, BarChart3, BookOpen, Users, TrendingUp,
  AlertTriangle, ArrowUpDown, X,
} from 'lucide-react';

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
}

interface ContentTopicRequest {
  id: string;
  workspaceId: string;
  topic: string;
  targetKeyword: string;
  intent: string;
  priority: string;
  rationale: string;
  status: 'requested' | 'brief_generated' | 'client_review' | 'approved' | 'changes_requested' | 'in_progress' | 'delivered' | 'declined';
  briefId?: string;
  clientNote?: string;
  internalNote?: string;
  declineReason?: string;
  clientFeedback?: string;
  source?: 'strategy' | 'client';
  serviceType?: 'brief_only' | 'full_post';
  upgradedAt?: string;
  comments?: { id: string; author: 'client' | 'team'; content: string; createdAt: string }[];
  requestedAt: string;
  updatedAt: string;
}

export function ContentBriefs({ workspaceId, onRequestCountChange }: { workspaceId: string; onRequestCountChange?: (pending: number) => void }) {
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
  const [briefSort, setBriefSort] = useState<'date' | 'keyword' | 'difficulty'>('date');
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'brief' | 'request'; id: string; label: string } | null>(null);

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
      const res = await fetch(url);
      const text = await res.text();
      if (res.ok) {
        try {
          const brief = JSON.parse(text);
          setBriefs(prev => [brief, ...prev.filter(b => b.id !== brief.id)]);
          setLoadingBrief(null);
          setExpandedRequest(reqId);
          return;
        } catch {
          setBriefError(`Response was not valid JSON. Status: ${res.status}. Body starts with: ${text.slice(0, 120)}`);
          setExpandedRequest(reqId);
          setLoadingBrief(null);
          return;
        }
      }
      // Individual fetch failed — try refetching the full list as fallback
      const listRes = await fetch(`/api/content-briefs/${workspaceId}`);
      if (listRes.ok) {
        const listText = await listRes.text();
        try {
          const allBriefs = JSON.parse(listText);
          if (Array.isArray(allBriefs)) {
            setBriefs(allBriefs);
            const found = allBriefs.find((b: ContentBrief) => b.id === briefId);
            if (found) {
              setLoadingBrief(null);
              setExpandedRequest(reqId);
              return;
            }
          }
        } catch { /* list parse failed */ }
      }
      setBriefError(`Brief "${briefId}" not found. Single fetch: ${res.status}. The brief may have been lost after a server restart. Try regenerating.`);
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
      const res = await fetch(`/api/content-requests/${workspaceId}/${reqId}`, { method: 'DELETE' });
      if (res.ok) {
        setClientRequests(prev => {
          const next = prev.filter(r => r.id !== reqId);
          onRequestCountChange?.(next.filter(r => r.status === 'requested').length);
          return next;
        });
        if (expandedRequest === reqId) setExpandedRequest(null);
      }
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

  useEffect(() => {
    let done = 0;
    const checkDone = () => { if (++done >= 2) setLoading(false); };

    fetch(`/api/content-briefs/${workspaceId}`)
      .then(async r => {
        const text = await r.text();
        console.log(`[ContentBriefs] briefs status=${r.status} len=${text.length}`);
        try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) { console.log(`[ContentBriefs] ${parsed.length} briefs loaded`); setBriefs(parsed); } else { console.warn('[ContentBriefs] briefs response is not array:', typeof parsed); } } catch { console.error('[ContentBriefs] briefs JSON parse failed, starts with:', text.slice(0, 200)); }
      })
      .catch(err => console.error('[ContentBriefs] briefs fetch error:', err))
      .finally(checkDone);

    fetch(`/api/content-requests/${workspaceId}`)
      .then(r => { console.log('[ContentBriefs] requests response status:', r.status); return r.json(); })
      .then(r => {
        console.log('[ContentBriefs] requests data:', r);
        if (Array.isArray(r)) {
          setClientRequests(r);
          onRequestCountChange?.(r.filter((req: ContentTopicRequest) => req.status === 'requested').length);
        }
      })
      .catch(err => console.error('[ContentBriefs] requests fetch error:', err))
      .finally(checkDone);
  }, [workspaceId]);

  const handleGenerateBriefForRequest = async (req: ContentTopicRequest) => {
    setGeneratingBriefFor(req.id);
    try {
      const res = await fetch(`/api/content-requests/${workspaceId}/${req.id}/generate-brief`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      const brief = await res.json();
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

  const handleUpdateRequestStatus = async (reqId: string, status: ContentTopicRequest['status']) => {
    try {
      const res = await fetch(`/api/content-requests/${workspaceId}/${reqId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated = await res.json();
        setClientRequests(prev => {
          const next = prev.map(r => r.id === reqId ? updated : r);
          onRequestCountChange?.(next.filter(r => r.status === 'requested').length);
          return next;
        });
      }
    } catch { /* skip */ }
  };

  const handleGenerate = async () => {
    if (!keyword.trim()) return;
    setGenerating(true);
    setError('');
    try {
      const res = await fetch(`/api/content-briefs/${workspaceId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetKeyword: keyword.trim(), businessContext: businessCtx.trim() || undefined }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate');
      }
      const brief = await res.json();
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
    await fetch(`/api/content-briefs/${workspaceId}/${briefId}`, { method: 'DELETE' });
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
        <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
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

      {/* Client Requests */}
      {clientRequests.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-amber-500/20 p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Inbox className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-medium text-zinc-300">Client Content Requests</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
              {clientRequests.filter(r => r.status === 'requested').length} new
            </span>
          </div>
          <div className="space-y-2">
            {clientRequests.map(req => {
              const statusConfig: Record<string, { icon: typeof Clock; color: string; label: string }> = {
                requested: { icon: Clock, color: 'text-amber-400', label: 'Awaiting Review' },
                brief_generated: { icon: FileText, color: 'text-blue-400', label: 'Brief Ready' },
                client_review: { icon: Clock, color: 'text-cyan-400', label: 'Client Review' },
                approved: { icon: CheckCircle2, color: 'text-green-400', label: 'Approved' },
                changes_requested: { icon: Clock, color: 'text-orange-400', label: 'Changes Requested' },
                in_progress: { icon: Zap, color: 'text-violet-400', label: 'In Progress' },
                delivered: { icon: CheckCircle2, color: 'text-green-400', label: 'Delivered' },
                declined: { icon: XCircle, color: 'text-zinc-500', label: 'Declined' },
              };
              const sc = statusConfig[req.status] || statusConfig.requested;
              const StatusIcon = sc.icon;
              const isGenerating = generatingBriefFor === req.id;
              const hasBrief = !!req.briefId;
              const inlineBrief = hasBrief && expandedRequest === req.id ? getBriefById(req.briefId!) : null;
              return (
                <div key={req.id} className="rounded-lg bg-zinc-800/50 border border-zinc-800 overflow-hidden">
                  <div className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-zinc-200">{req.topic}</span>
                          {req.source === 'client' && <span className="text-[8px] px-1 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">Client</span>}
                          <span className={`text-[8px] px-1 py-0.5 rounded border ${(req.serviceType || 'brief_only') === 'full_post' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}>{(req.serviceType || 'brief_only') === 'full_post' ? 'Full Post' : 'Brief Only'}</span>
                          {req.upgradedAt && <span className="text-[8px] px-1 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">Upgraded</span>}
                        </div>
                        <div className="text-[10px] text-teal-400 mt-0.5">"{req.targetKeyword}"</div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[9px] text-zinc-600 uppercase">{req.intent} · {req.priority}</span>
                          <span className="text-[9px] text-zinc-600">{new Date(req.requestedAt).toLocaleDateString()}</span>
                          {req.comments && req.comments.length > 0 && <span className="flex items-center gap-0.5 text-[9px] text-zinc-500"><MessageSquare className="w-2.5 h-2.5" />{req.comments.length}</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <span className={`flex items-center gap-1 text-[10px] ${sc.color}`}><StatusIcon className="w-3 h-3" /> {sc.label}</span>
                        <div className="flex items-center gap-1 flex-wrap justify-end">
                          {hasBrief && req.status !== 'requested' && (
                            <button onClick={() => toggleRequestBrief(req.id, req.briefId!)} disabled={loadingBrief === req.id} className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] transition-colors ${expandedRequest === req.id ? 'bg-blue-600/30 border-blue-500/40 text-blue-200' : 'bg-blue-600/20 border-blue-500/30 text-blue-300 hover:bg-blue-600/30'}`}>
                              {loadingBrief === req.id ? <><Loader2 className="w-3 h-3 animate-spin" /> Loading...</> : expandedRequest === req.id ? 'Hide Brief' : 'View Brief'}
                            </button>
                          )}
                          {req.status === 'requested' && (
                            <>
                              <button disabled={isGenerating} onClick={() => handleGenerateBriefForRequest(req)} className="flex items-center gap-1 px-2 py-1 rounded bg-teal-600/20 border border-teal-500/30 text-[10px] text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50">
                                {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                {isGenerating ? 'Generating...' : 'Generate Brief'}
                              </button>
                              <button onClick={() => handleUpdateRequestStatus(req.id, 'declined')} className="px-2 py-1 rounded bg-zinc-800 text-[10px] text-zinc-500 hover:text-red-400 transition-colors">Decline</button>
                            </>
                          )}
                          {req.status === 'brief_generated' && (
                            <button onClick={() => handleUpdateRequestStatus(req.id, 'client_review')} className="px-2 py-1 rounded bg-cyan-600/20 border border-cyan-500/30 text-[10px] text-cyan-300 hover:bg-cyan-600/30 transition-colors">Send to Client</button>
                          )}
                          {req.status === 'client_review' && (
                            <span className="text-[9px] text-cyan-400/60 italic">Awaiting client feedback</span>
                          )}
                          {req.status === 'approved' && (
                            <button onClick={() => handleUpdateRequestStatus(req.id, 'in_progress')} className="px-2 py-1 rounded bg-violet-600/20 border border-violet-500/30 text-[10px] text-violet-300 hover:bg-violet-600/30 transition-colors">Start Production</button>
                          )}
                          {req.status === 'changes_requested' && (
                            <button onClick={() => handleUpdateRequestStatus(req.id, 'client_review')} className="px-2 py-1 rounded bg-cyan-600/20 border border-cyan-500/30 text-[10px] text-cyan-300 hover:bg-cyan-600/30 transition-colors">Resubmit to Client</button>
                          )}
                          {req.status === 'in_progress' && (
                            <button onClick={() => handleUpdateRequestStatus(req.id, 'delivered')} className="px-2 py-1 rounded bg-green-600/20 border border-green-500/30 text-[10px] text-green-300 hover:bg-green-600/30 transition-colors">Mark Delivered</button>
                          )}
                        </div>
                      </div>
                    </div>
                    {req.status === 'changes_requested' && req.clientFeedback && (
                      <div className="mt-2 text-[10px] text-orange-300/80 bg-orange-500/10 px-2.5 py-1.5 rounded border border-orange-500/20"><span className="text-orange-400 font-medium">Client feedback:</span> {req.clientFeedback}</div>
                    )}
                    {req.status === 'declined' && req.declineReason && (
                      <div className="mt-2 text-[10px] text-zinc-500 bg-zinc-800/50 px-2.5 py-1.5 rounded border border-zinc-800"><span className="text-zinc-400 font-medium">Reason:</span> {req.declineReason}</div>
                    )}
                    <div className="flex items-center justify-end mt-1.5">
                      <button onClick={(e) => { e.stopPropagation(); confirmDeleteRequest(req); }} className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded hover:bg-red-500/10">
                        <Trash2 className="w-3 h-3" /> Delete Request
                      </button>
                    </div>
                  </div>
                  {/* Brief error message */}
                  {expandedRequest === req.id && !inlineBrief && briefError && (
                    <div className="border-t border-red-500/20 px-3 py-3 bg-red-950/20">
                      <div className="flex items-center gap-2 text-[11px] text-red-400">
                        <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{briefError}</span>
                      </div>
                      <button onClick={() => { handleGenerateBriefForRequest(req); setBriefError(null); setExpandedRequest(null); }} className="mt-2 flex items-center gap-1 px-2 py-1 rounded bg-teal-600/20 border border-teal-500/30 text-[10px] text-teal-300 hover:bg-teal-600/30 transition-colors">
                        <Sparkles className="w-3 h-3" /> Regenerate Brief
                      </button>
                    </div>
                  )}
                  {/* Full inline brief detail */}
                  {inlineBrief && (
                    <div className="border-t border-zinc-800 px-4 pb-4 space-y-4">
                      {/* Export buttons */}
                      <div className="pt-3 flex items-center gap-2">
                        <button onClick={() => copyAsMarkdown(inlineBrief)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 transition-colors">
                          <Copy className="w-3 h-3" /> Copy for AI Tool
                        </button>
                        <button onClick={() => exportClientHTML(inlineBrief)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors">
                          <Download className="w-3 h-3" /> Export PDF
                        </button>
                        <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(inlineBrief, null, 2)); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
                          <Copy className="w-3 h-3" /> Copy JSON
                        </button>
                      </div>

                      {/* Executive Summary */}
                      {inlineBrief.executiveSummary && (
                        <div className="bg-teal-500/5 border border-teal-500/20 rounded-lg px-4 py-3">
                          <div className="flex items-center gap-1.5 mb-1.5"><BookOpen className="w-3.5 h-3.5 text-teal-400" /><span className="text-[10px] text-teal-400 font-medium uppercase tracking-wider">Executive Summary</span></div>
                          <div className="text-xs text-zinc-300 leading-relaxed">{inlineBrief.executiveSummary}</div>
                        </div>
                      )}

                      {/* Title & Meta */}
                      <div className="space-y-2">
                        <div>
                          <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Suggested Title</div>
                          <div className="text-xs text-teal-400 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">{inlineBrief.suggestedTitle}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Meta Description</div>
                          <div className="text-xs text-zinc-300 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">{inlineBrief.suggestedMetaDesc}</div>
                        </div>
                      </div>

                      {/* Key Metrics Row */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                          <div className="text-[10px] text-zinc-500 mb-0.5">Word Count</div>
                          <div className="text-sm font-bold text-blue-400">{inlineBrief.wordCountTarget?.toLocaleString()}</div>
                        </div>
                        <div className="bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                          <div className="text-[10px] text-zinc-500 mb-0.5">Intent</div>
                          <div className="text-xs text-zinc-300 capitalize font-medium">{inlineBrief.intent}</div>
                        </div>
                        {inlineBrief.contentFormat && (
                          <div className="bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                            <div className="text-[10px] text-zinc-500 mb-0.5">Format</div>
                            <div className="text-xs text-amber-400 capitalize font-medium">{inlineBrief.contentFormat}</div>
                          </div>
                        )}
                        {inlineBrief.difficultyScore != null && (
                          <div className="bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                            <div className="text-[10px] text-zinc-500 mb-0.5">Difficulty</div>
                            <div className={`text-sm font-bold ${inlineBrief.difficultyScore <= 30 ? 'text-green-400' : inlineBrief.difficultyScore <= 60 ? 'text-amber-400' : 'text-red-400'}`}>{inlineBrief.difficultyScore}/100</div>
                          </div>
                        )}
                      </div>

                      {/* Traffic Potential */}
                      {inlineBrief.trafficPotential && (
                        <div className="flex items-start gap-2 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                          <TrendingUp className="w-3.5 h-3.5 text-green-400 mt-0.5 flex-shrink-0" />
                          <div><div className="text-[10px] text-zinc-500 mb-0.5">Traffic Potential</div><div className="text-xs text-zinc-300">{inlineBrief.trafficPotential}</div></div>
                        </div>
                      )}

                      {/* Audience & Tone */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <div className="flex items-center gap-1.5 mb-1"><Users className="w-3 h-3 text-zinc-500" /><span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Audience</span></div>
                          <div className="text-xs text-zinc-400 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">{inlineBrief.audience}</div>
                        </div>
                        {inlineBrief.toneAndStyle && (
                          <div>
                            <div className="flex items-center gap-1.5 mb-1"><MessageSquare className="w-3 h-3 text-zinc-500" /><span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Tone & Style</span></div>
                            <div className="text-xs text-zinc-400 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">{inlineBrief.toneAndStyle}</div>
                          </div>
                        )}
                      </div>

                      {/* Secondary Keywords */}
                      {inlineBrief.secondaryKeywords?.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5"><Search className="w-3 h-3 text-zinc-500" /><span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Secondary Keywords</span></div>
                          <div className="flex flex-wrap gap-1.5">
                            {inlineBrief.secondaryKeywords.map((kw, i) => (
                              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{kw}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Topical Entities */}
                      {inlineBrief.topicalEntities && inlineBrief.topicalEntities.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5"><Target className="w-3 h-3 text-zinc-500" /><span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Topical Entities to Cover</span></div>
                          <div className="flex flex-wrap gap-1.5">
                            {inlineBrief.topicalEntities.map((entity, i) => (
                              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300">{entity}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* People Also Ask */}
                      {inlineBrief.peopleAlsoAsk && inlineBrief.peopleAlsoAsk.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5"><MessageSquare className="w-3 h-3 text-zinc-500" /><span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Questions to Answer</span></div>
                          <div className="space-y-1">
                            {inlineBrief.peopleAlsoAsk.map((q, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs text-zinc-300 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                                <span className="text-amber-400 flex-shrink-0 font-medium">Q{i + 1}.</span> {q}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* SERP Analysis */}
                      {inlineBrief.serpAnalysis && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5"><BarChart3 className="w-3 h-3 text-zinc-500" /><span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">SERP Analysis</span></div>
                          <div className="bg-zinc-950 rounded-lg px-3 py-3 border border-zinc-800 space-y-2">
                            <div className="grid grid-cols-2 gap-3">
                              <div><span className="text-[10px] text-zinc-500">Content Type:</span><span className="text-xs text-zinc-300 ml-1">{inlineBrief.serpAnalysis.contentType}</span></div>
                              <div><span className="text-[10px] text-zinc-500">Avg Word Count:</span><span className="text-xs text-zinc-300 ml-1">{inlineBrief.serpAnalysis.avgWordCount.toLocaleString()}</span></div>
                            </div>
                            {inlineBrief.serpAnalysis.commonElements.length > 0 && (
                              <div><span className="text-[10px] text-zinc-500 block mb-1">Common Elements:</span><div className="flex flex-wrap gap-1">{inlineBrief.serpAnalysis.commonElements.map((el, i) => <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{el}</span>)}</div></div>
                            )}
                            {inlineBrief.serpAnalysis.gaps.length > 0 && (
                              <div><span className="text-[10px] text-green-400/80 block mb-1">Opportunities (gaps in existing content):</span><div className="space-y-1">{inlineBrief.serpAnalysis.gaps.map((g, i) => <div key={i} className="text-[11px] text-green-300/80 flex items-start gap-1.5"><span className="text-green-400 mt-0.5">→</span>{g}</div>)}</div></div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Content Outline */}
                      {inlineBrief.outline?.length > 0 && (
                        <div>
                          <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-2">Content Outline</div>
                          <div className="space-y-2">
                            {inlineBrief.outline.map((section, i) => (
                              <div key={i} className="bg-zinc-950 rounded-lg px-3 py-2.5 border border-zinc-800">
                                <div className="flex items-center justify-between">
                                  <div className="text-xs font-medium text-zinc-200">H2: {section.heading}</div>
                                  {section.wordCount && <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{section.wordCount} words</span>}
                                </div>
                                <div className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{section.notes}</div>
                                {section.keywords && section.keywords.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1.5">{section.keywords.map((kw, j) => <span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400/80">{kw}</span>)}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* CTA Recommendations */}
                      {inlineBrief.ctaRecommendations && inlineBrief.ctaRecommendations.length > 0 && (
                        <div>
                          <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1.5">CTA Recommendations</div>
                          <div className="space-y-1">{inlineBrief.ctaRecommendations.map((cta, i) => (
                            <div key={i} className="text-xs text-zinc-300 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800 flex items-start gap-2">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${i === 0 ? 'bg-teal-500/20 text-teal-400' : 'bg-zinc-800 text-zinc-500'}`}>{i === 0 ? 'Primary' : 'Secondary'}</span>{cta}
                            </div>
                          ))}</div>
                        </div>
                      )}

                      {/* Competitor Insights */}
                      {inlineBrief.competitorInsights && (
                        <div>
                          <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Competitor Insights</div>
                          <div className="text-xs text-zinc-400 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800 leading-relaxed">{inlineBrief.competitorInsights}</div>
                        </div>
                      )}

                      {/* Internal Links */}
                      {inlineBrief.internalLinkSuggestions?.length > 0 && (
                        <div>
                          <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Internal Link Suggestions</div>
                          <div className="flex flex-wrap gap-1.5">
                            {inlineBrief.internalLinkSuggestions.map((link, i) => (
                              <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-blue-400">/{link}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* E-E-A-T Guidance */}
                      {inlineBrief.eeatGuidance && (
                        <div>
                          <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-2">E-E-A-T Signals</div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {[
                              { label: 'Experience', value: inlineBrief.eeatGuidance.experience, color: 'text-blue-400' },
                              { label: 'Expertise', value: inlineBrief.eeatGuidance.expertise, color: 'text-teal-400' },
                              { label: 'Authority', value: inlineBrief.eeatGuidance.authority, color: 'text-violet-400' },
                              { label: 'Trust', value: inlineBrief.eeatGuidance.trust, color: 'text-amber-400' },
                            ].filter(e => e.value).map((e, i) => (
                              <div key={i} className="bg-zinc-950 rounded-lg px-3 py-2.5 border border-zinc-800">
                                <div className={`text-[9px] ${e.color} font-medium uppercase tracking-wider mb-1`}>{e.label}</div>
                                <div className="text-[11px] text-zinc-400 leading-relaxed">{e.value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Content Checklist */}
                      {inlineBrief.contentChecklist && inlineBrief.contentChecklist.length > 0 && (
                        <div>
                          <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-2">Content Checklist</div>
                          <div className="bg-zinc-950 rounded-lg border border-zinc-800 divide-y divide-zinc-800/50">
                            {inlineBrief.contentChecklist.map((item, i) => (
                              <div key={i} className="flex items-start gap-2.5 px-4 py-2.5">
                                <div className="w-4 h-4 mt-0.5 rounded border border-zinc-700 flex-shrink-0" />
                                <span className="text-[11px] text-zinc-400 leading-relaxed">{item}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Schema Recommendations */}
                      {inlineBrief.schemaRecommendations && inlineBrief.schemaRecommendations.length > 0 && (
                        <div>
                          <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-2">Schema Markup</div>
                          <div className="space-y-2">
                            {inlineBrief.schemaRecommendations.map((schema, i) => (
                              <div key={i} className="bg-zinc-950 rounded-lg px-4 py-3 border border-zinc-800">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-medium">{schema.type}</span>
                                </div>
                                <div className="text-[11px] text-zinc-400 leading-relaxed">{schema.notes}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clipboard className="w-5 h-5 text-teal-400" />
            <h2 className="text-sm font-semibold text-zinc-200">Content Briefs</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{briefs.length} total</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-600 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={briefSearch}
                onChange={e => setBriefSearch(e.target.value)}
                placeholder="Search briefs..."
                className="w-48 pl-8 pr-7 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 focus:border-zinc-700 focus:outline-none"
              />
              {briefSearch && (
                <button onClick={() => setBriefSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 text-[10px] text-zinc-500">
              <ArrowUpDown className="w-3 h-3" />
              <select value={briefSort} onChange={e => setBriefSort(e.target.value as 'date' | 'keyword' | 'difficulty')} className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-[10px] text-zinc-400 focus:outline-none cursor-pointer">
                <option value="date">Newest</option>
                <option value="keyword">Keyword A-Z</option>
                <option value="difficulty">Difficulty</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Generator */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-medium text-zinc-300">Generate AI Content Brief</span>
        </div>
        <div className="grid grid-cols-1 gap-2">
          <div>
            <label className="text-[10px] text-zinc-500 block mb-0.5">Target Keyword *</label>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="e.g. dental implants near me"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600"
              onKeyDown={e => e.key === 'Enter' && !generating && handleGenerate()}
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 block mb-0.5">Business Context (optional)</label>
            <input
              type="text"
              value={businessCtx}
              onChange={e => setBusinessCtx(e.target.value)}
              placeholder="e.g. Local dental practice in Austin, TX specializing in cosmetic dentistry"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600"
            />
          </div>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          onClick={handleGenerate}
          disabled={!keyword.trim() || generating}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-40 transition-colors"
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {generating ? 'Generating...' : 'Generate Brief'}
        </button>
      </div>

      {/* Briefs list (standalone — not linked to a request) */}
      {(() => {
        const linkedBriefIds = new Set(clientRequests.filter(r => r.briefId).map(r => r.briefId!));
        let standaloneBriefs = briefs.filter(b => !linkedBriefIds.has(b.id));

        // Apply search filter
        if (briefSearch.trim()) {
          const q = briefSearch.toLowerCase();
          standaloneBriefs = standaloneBriefs.filter(b =>
            b.targetKeyword.toLowerCase().includes(q) ||
            b.suggestedTitle.toLowerCase().includes(q) ||
            b.intent.toLowerCase().includes(q) ||
            b.secondaryKeywords.some(k => k.toLowerCase().includes(q))
          );
        }

        // Apply sort
        standaloneBriefs = [...standaloneBriefs].sort((a, b) => {
          if (briefSort === 'keyword') return a.targetKeyword.localeCompare(b.targetKeyword);
          if (briefSort === 'difficulty') return (b.difficultyScore ?? 0) - (a.difficultyScore ?? 0);
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        if (standaloneBriefs.length === 0 && !briefSearch.trim()) return (
          <div className="text-center py-12">
            <FileText className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
            <p className="text-sm text-zinc-500">No standalone briefs yet</p>
            <p className="text-xs text-zinc-600 mt-1">Generate a brief above, or briefs linked to requests will appear in the request cards</p>
          </div>
        );

        if (standaloneBriefs.length === 0 && briefSearch.trim()) return (
          <div className="text-center py-8">
            <Search className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
            <p className="text-sm text-zinc-500">No briefs match &ldquo;{briefSearch}&rdquo;</p>
            <button onClick={() => setBriefSearch('')} className="text-xs text-teal-400 mt-1 hover:underline">Clear search</button>
          </div>
        );

        return (
        <div className="space-y-2">
          {standaloneBriefs.map(brief => (
            <div key={brief.id} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden group/brief">
              {/* Brief header row — metrics + quick actions visible at all times */}
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => setExpanded(expanded === brief.id ? null : brief.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-zinc-200 truncate">{brief.targetKeyword}</span>
                    {brief.difficultyScore != null && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${brief.difficultyScore <= 30 ? 'bg-green-500/10 text-green-400 border border-green-500/20' : brief.difficultyScore <= 60 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>{brief.difficultyScore}/100</span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{brief.suggestedTitle}</div>
                </button>
                {/* At-a-glance metrics */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">{brief.wordCountTarget.toLocaleString()} words</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 capitalize">{brief.intent}</span>
                  {brief.contentFormat && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/80 border border-amber-500/20 capitalize hidden sm:inline-block">{brief.contentFormat}</span>}
                </div>
                {/* Quick actions — always visible */}
                <div className="flex items-center gap-0.5 flex-shrink-0 opacity-40 group-hover/brief:opacity-100 transition-opacity">
                  <button onClick={(e) => { e.stopPropagation(); copyAsMarkdown(brief); }} title="Copy for AI tool" className="p-1.5 rounded hover:bg-violet-500/10 text-zinc-500 hover:text-violet-400 transition-colors">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); exportClientHTML(brief); }} title="Export PDF" className="p-1.5 rounded hover:bg-teal-500/10 text-zinc-500 hover:text-teal-400 transition-colors">
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); confirmDeleteBrief(brief); }} title="Delete brief" className="p-1.5 rounded hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* Date + expand */}
                <span className="text-[10px] text-zinc-600 flex-shrink-0">{new Date(brief.createdAt).toLocaleDateString()}</span>
                <button onClick={() => setExpanded(expanded === brief.id ? null : brief.id)} className="flex-shrink-0 p-1 rounded hover:bg-zinc-800 transition-colors">
                  {expanded === brief.id ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
                </button>
              </div>

              {/* Brief details */}
              {expanded === brief.id && (
                <div className="px-4 pb-4 space-y-4 border-t border-zinc-800">
                  {/* Export buttons */}
                  <div className="pt-3 flex items-center gap-2">
                    <button onClick={() => copyAsMarkdown(brief)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 transition-colors">
                      <Copy className="w-3 h-3" /> Copy for AI Tool
                    </button>
                    <button onClick={() => exportClientHTML(brief)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors">
                      <Download className="w-3 h-3" /> Export PDF
                    </button>
                    <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(brief, null, 2)); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
                      <Copy className="w-3 h-3" /> Copy JSON
                    </button>
                  </div>

                  {/* Executive Summary */}
                  {brief.executiveSummary && (
                    <div className="bg-teal-500/5 border border-teal-500/20 rounded-lg px-4 py-3">
                      <div className="flex items-center gap-1.5 mb-1.5"><BookOpen className="w-3.5 h-3.5 text-teal-400" /><span className="text-[10px] text-teal-400 font-medium uppercase tracking-wider">Executive Summary</span></div>
                      <div className="text-xs text-zinc-300 leading-relaxed">{brief.executiveSummary}</div>
                    </div>
                  )}

                  {/* Title & Meta */}
                  <div className="space-y-2">
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Suggested Title</div>
                      <div className="text-xs text-teal-400 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">{brief.suggestedTitle}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Meta Description</div>
                      <div className="text-xs text-zinc-300 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">{brief.suggestedMetaDesc}</div>
                    </div>
                  </div>

                  {/* Key Metrics Row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                      <div className="text-[10px] text-zinc-500 mb-0.5">Word Count</div>
                      <div className="text-sm font-bold text-blue-400">{brief.wordCountTarget.toLocaleString()}</div>
                    </div>
                    <div className="bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                      <div className="text-[10px] text-zinc-500 mb-0.5">Intent</div>
                      <div className="text-xs text-zinc-300 capitalize font-medium">{brief.intent}</div>
                    </div>
                    {brief.contentFormat && (
                      <div className="bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                        <div className="text-[10px] text-zinc-500 mb-0.5">Format</div>
                        <div className="text-xs text-amber-400 capitalize font-medium">{brief.contentFormat}</div>
                      </div>
                    )}
                    {brief.difficultyScore != null && (
                      <div className="bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                        <div className="text-[10px] text-zinc-500 mb-0.5">Difficulty</div>
                        <div className={`text-sm font-bold ${brief.difficultyScore <= 30 ? 'text-green-400' : brief.difficultyScore <= 60 ? 'text-amber-400' : 'text-red-400'}`}>{brief.difficultyScore}/100</div>
                      </div>
                    )}
                  </div>

                  {/* Traffic Potential */}
                  {brief.trafficPotential && (
                    <div className="flex items-start gap-2 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                      <TrendingUp className="w-3.5 h-3.5 text-green-400 mt-0.5 flex-shrink-0" />
                      <div><div className="text-[10px] text-zinc-500 mb-0.5">Traffic Potential</div><div className="text-xs text-zinc-300">{brief.trafficPotential}</div></div>
                    </div>
                  )}

                  {/* Audience & Tone */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1"><Users className="w-3 h-3 text-zinc-500" /><span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Audience</span></div>
                      <div className="text-xs text-zinc-400 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">{brief.audience}</div>
                    </div>
                    {brief.toneAndStyle && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-1"><MessageSquare className="w-3 h-3 text-zinc-500" /><span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Tone & Style</span></div>
                        <div className="text-xs text-zinc-400 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">{brief.toneAndStyle}</div>
                      </div>
                    )}
                  </div>

                  {/* Secondary Keywords */}
                  {brief.secondaryKeywords.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5"><Search className="w-3 h-3 text-zinc-500" /><span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Secondary Keywords</span></div>
                      <div className="flex flex-wrap gap-1.5">
                        {brief.secondaryKeywords.map((kw, i) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Topical Entities */}
                  {brief.topicalEntities && brief.topicalEntities.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5"><Target className="w-3 h-3 text-zinc-500" /><span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Topical Entities to Cover</span></div>
                      <div className="flex flex-wrap gap-1.5">
                        {brief.topicalEntities.map((entity, i) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300">{entity}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* People Also Ask */}
                  {brief.peopleAlsoAsk && brief.peopleAlsoAsk.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5"><MessageSquare className="w-3 h-3 text-zinc-500" /><span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Questions to Answer</span></div>
                      <div className="space-y-1">
                        {brief.peopleAlsoAsk.map((q, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-zinc-300 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                            <span className="text-amber-400 flex-shrink-0 font-medium">Q{i + 1}.</span> {q}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SERP Analysis */}
                  {brief.serpAnalysis && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5"><BarChart3 className="w-3 h-3 text-zinc-500" /><span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">SERP Analysis</span></div>
                      <div className="bg-zinc-950 rounded-lg px-3 py-3 border border-zinc-800 space-y-2">
                        <div className="grid grid-cols-2 gap-3">
                          <div><span className="text-[10px] text-zinc-500">Content Type:</span><span className="text-xs text-zinc-300 ml-1">{brief.serpAnalysis.contentType}</span></div>
                          <div><span className="text-[10px] text-zinc-500">Avg Word Count:</span><span className="text-xs text-zinc-300 ml-1">{brief.serpAnalysis.avgWordCount.toLocaleString()}</span></div>
                        </div>
                        {brief.serpAnalysis.commonElements.length > 0 && (
                          <div><span className="text-[10px] text-zinc-500 block mb-1">Common Elements:</span><div className="flex flex-wrap gap-1">{brief.serpAnalysis.commonElements.map((el, i) => <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{el}</span>)}</div></div>
                        )}
                        {brief.serpAnalysis.gaps.length > 0 && (
                          <div><span className="text-[10px] text-green-400/80 block mb-1">Opportunities (gaps in existing content):</span><div className="space-y-1">{brief.serpAnalysis.gaps.map((g, i) => <div key={i} className="text-[11px] text-green-300/80 flex items-start gap-1.5"><span className="text-green-400 mt-0.5">→</span>{g}</div>)}</div></div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Content Outline */}
                  {brief.outline.length > 0 && (
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-2">Content Outline</div>
                      <div className="space-y-2">
                        {brief.outline.map((section, i) => (
                          <div key={i} className="bg-zinc-950 rounded-lg px-3 py-2.5 border border-zinc-800">
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-medium text-zinc-200">H2: {section.heading}</div>
                              {section.wordCount && <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{section.wordCount} words</span>}
                            </div>
                            <div className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{section.notes}</div>
                            {section.keywords && section.keywords.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">{section.keywords.map((kw, j) => <span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400/80">{kw}</span>)}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* CTA Recommendations */}
                  {brief.ctaRecommendations && brief.ctaRecommendations.length > 0 && (
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1.5">CTA Recommendations</div>
                      <div className="space-y-1">{brief.ctaRecommendations.map((cta, i) => (
                        <div key={i} className="text-xs text-zinc-300 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800 flex items-start gap-2">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${i === 0 ? 'bg-teal-500/20 text-teal-400' : 'bg-zinc-800 text-zinc-500'}`}>{i === 0 ? 'Primary' : 'Secondary'}</span>{cta}
                        </div>
                      ))}</div>
                    </div>
                  )}

                  {/* Competitor Insights */}
                  {brief.competitorInsights && (
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Competitor Insights</div>
                      <div className="text-xs text-zinc-400 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800 leading-relaxed">{brief.competitorInsights}</div>
                    </div>
                  )}

                  {/* Internal Links */}
                  {brief.internalLinkSuggestions.length > 0 && (
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Internal Link Suggestions</div>
                      <div className="flex flex-wrap gap-1.5">
                        {brief.internalLinkSuggestions.map((link, i) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-blue-400">/{link}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* E-E-A-T Guidance */}
                  {brief.eeatGuidance && (
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-2">E-E-A-T Signals</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[
                          { label: 'Experience', value: brief.eeatGuidance.experience, color: 'text-blue-400' },
                          { label: 'Expertise', value: brief.eeatGuidance.expertise, color: 'text-teal-400' },
                          { label: 'Authority', value: brief.eeatGuidance.authority, color: 'text-violet-400' },
                          { label: 'Trust', value: brief.eeatGuidance.trust, color: 'text-amber-400' },
                        ].filter(e => e.value).map((e, i) => (
                          <div key={i} className="bg-zinc-950 rounded-lg px-3 py-2.5 border border-zinc-800">
                            <div className={`text-[9px] ${e.color} font-medium uppercase tracking-wider mb-1`}>{e.label}</div>
                            <div className="text-[11px] text-zinc-400 leading-relaxed">{e.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Content Checklist */}
                  {brief.contentChecklist && brief.contentChecklist.length > 0 && (
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-2">Content Checklist</div>
                      <div className="bg-zinc-950 rounded-lg border border-zinc-800 divide-y divide-zinc-800/50">
                        {brief.contentChecklist.map((item, i) => (
                          <div key={i} className="flex items-start gap-2.5 px-4 py-2.5">
                            <div className="w-4 h-4 mt-0.5 rounded border border-zinc-700 flex-shrink-0" />
                            <span className="text-[11px] text-zinc-400 leading-relaxed">{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Schema Recommendations */}
                  {brief.schemaRecommendations && brief.schemaRecommendations.length > 0 && (
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-2">Schema Markup</div>
                      <div className="space-y-2">
                        {brief.schemaRecommendations.map((schema, i) => (
                          <div key={i} className="bg-zinc-950 rounded-lg px-4 py-3 border border-zinc-800">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-medium">{schema.type}</span>
                            </div>
                            <div className="text-[11px] text-zinc-400 leading-relaxed">{schema.notes}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Delete */}
                  <div className="pt-3 border-t border-zinc-800 flex items-center justify-between">
                    <button
                      onClick={() => confirmDeleteBrief(brief)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium text-red-400/70 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete Brief
                    </button>
                    <span className="text-[9px] text-zinc-700">Created {new Date(brief.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        );
      })()}
    </div>
  );
}
