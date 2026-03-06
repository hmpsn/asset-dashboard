import { useState, useEffect } from 'react';
import { Loader2, Clipboard, Trash2, ChevronDown, ChevronUp, Sparkles, FileText, Inbox, CheckCircle2, XCircle, Clock, Zap } from 'lucide-react';

interface ContentBrief {
  id: string;
  workspaceId: string;
  targetKeyword: string;
  secondaryKeywords: string[];
  suggestedTitle: string;
  suggestedMetaDesc: string;
  outline: { heading: string; notes: string }[];
  wordCountTarget: number;
  intent: string;
  audience: string;
  competitorInsights: string;
  internalLinkSuggestions: string[];
  createdAt: string;
}

interface ContentTopicRequest {
  id: string;
  workspaceId: string;
  topic: string;
  targetKeyword: string;
  intent: string;
  priority: string;
  rationale: string;
  status: 'requested' | 'brief_generated' | 'in_progress' | 'delivered' | 'declined';
  briefId?: string;
  clientNote?: string;
  internalNote?: string;
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
  const [error, setError] = useState('');

  useEffect(() => {
    let done = 0;
    const checkDone = () => { if (++done >= 2) setLoading(false); };

    fetch(`/api/content-briefs/${workspaceId}`)
      .then(r => { console.log('[ContentBriefs] briefs response status:', r.status); return r.json(); })
      .then(b => { console.log('[ContentBriefs] briefs data:', b); if (Array.isArray(b)) setBriefs(b); })
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
      setExpanded(brief.id);
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
                in_progress: { icon: Zap, color: 'text-violet-400', label: 'In Progress' },
                delivered: { icon: CheckCircle2, color: 'text-green-400', label: 'Delivered' },
                declined: { icon: XCircle, color: 'text-zinc-500', label: 'Declined' },
              };
              const sc = statusConfig[req.status] || statusConfig.requested;
              const StatusIcon = sc.icon;
              const isGenerating = generatingBriefFor === req.id;
              return (
                <div key={req.id} className="px-3 py-2.5 rounded-lg bg-zinc-800/50 border border-zinc-800">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-zinc-200">{req.topic}</div>
                      <div className="text-[10px] text-teal-400 mt-0.5">Keyword: "{req.targetKeyword}"</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{req.rationale}</div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[9px] text-zinc-600 uppercase">{req.intent}</span>
                        <span className="text-[9px] text-zinc-600">{new Date(req.requestedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className={`flex items-center gap-1 text-[10px] ${sc.color}`}><StatusIcon className="w-3 h-3" /> {sc.label}</span>
                      {req.status === 'requested' && (
                        <div className="flex items-center gap-1">
                          <button
                            disabled={isGenerating}
                            onClick={() => handleGenerateBriefForRequest(req)}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-teal-600/20 border border-teal-500/30 text-[10px] text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50"
                          >
                            {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                            {isGenerating ? 'Generating...' : 'Generate Brief'}
                          </button>
                          <button
                            onClick={() => handleUpdateRequestStatus(req.id, 'declined')}
                            className="px-2 py-1 rounded bg-zinc-800 text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
                          >
                            Decline
                          </button>
                        </div>
                      )}
                      {req.status === 'brief_generated' && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { if (req.briefId) setExpanded(req.briefId); }}
                            className="px-2 py-1 rounded bg-blue-600/20 border border-blue-500/30 text-[10px] text-blue-300 hover:bg-blue-600/30 transition-colors"
                          >
                            View Brief
                          </button>
                          <button
                            onClick={() => handleUpdateRequestStatus(req.id, 'delivered')}
                            className="px-2 py-1 rounded bg-green-600/20 border border-green-500/30 text-[10px] text-green-300 hover:bg-green-600/30 transition-colors"
                          >
                            Mark Delivered
                          </button>
                        </div>
                      )}
                      {req.status === 'in_progress' && (
                        <button
                          onClick={() => handleUpdateRequestStatus(req.id, 'delivered')}
                          className="px-2 py-1 rounded bg-green-600/20 border border-green-500/30 text-[10px] text-green-300 hover:bg-green-600/30 transition-colors"
                        >
                          Mark Delivered
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clipboard className="w-5 h-5 text-teal-400" />
          <h2 className="text-sm font-semibold text-zinc-200">Content Briefs</h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{briefs.length}</span>
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

      {/* Briefs list */}
      {briefs.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
          <p className="text-sm text-zinc-500">No content briefs yet</p>
          <p className="text-xs text-zinc-600 mt-1">Enter a keyword above to generate an AI-powered content brief</p>
        </div>
      ) : (
        <div className="space-y-2">
          {briefs.map(brief => (
            <div key={brief.id} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              {/* Brief header */}
              <button
                onClick={() => setExpanded(expanded === brief.id ? null : brief.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-zinc-200 truncate">{brief.targetKeyword}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{brief.suggestedTitle}</div>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 flex-shrink-0">{brief.intent}</span>
                <span className="text-[10px] text-zinc-600 flex-shrink-0">{new Date(brief.createdAt).toLocaleDateString()}</span>
                {expanded === brief.id ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
              </button>

              {/* Brief details */}
              {expanded === brief.id && (
                <div className="px-4 pb-4 space-y-4 border-t border-zinc-800">
                  {/* Title & Meta */}
                  <div className="pt-3 space-y-2">
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Suggested Title</div>
                      <div className="text-xs text-teal-400 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">{brief.suggestedTitle}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Meta Description</div>
                      <div className="text-xs text-zinc-300 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">{brief.suggestedMetaDesc}</div>
                    </div>
                  </div>

                  {/* Keywords & Meta */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Word Count</div>
                      <div className="text-sm font-bold text-blue-400">{brief.wordCountTarget.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Search Intent</div>
                      <div className="text-xs text-zinc-300 capitalize">{brief.intent}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Audience</div>
                      <div className="text-xs text-zinc-300 truncate" title={brief.audience}>{brief.audience}</div>
                    </div>
                  </div>

                  {/* Secondary Keywords */}
                  {brief.secondaryKeywords.length > 0 && (
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Secondary Keywords</div>
                      <div className="flex flex-wrap gap-1.5">
                        {brief.secondaryKeywords.map((kw, i) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Outline */}
                  {brief.outline.length > 0 && (
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-2">Content Outline</div>
                      <div className="space-y-2">
                        {brief.outline.map((section, i) => (
                          <div key={i} className="bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                            <div className="text-xs font-medium text-zinc-200">{section.heading}</div>
                            <div className="text-[11px] text-zinc-500 mt-0.5">{section.notes}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Competitor Insights */}
                  {brief.competitorInsights && (
                    <div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1">Competitor Insights</div>
                      <div className="text-xs text-zinc-400 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">{brief.competitorInsights}</div>
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

                  {/* Delete */}
                  <div className="pt-2 border-t border-zinc-800">
                    <button
                      onClick={() => handleDelete(brief.id)}
                      className="flex items-center gap-1.5 text-[10px] text-zinc-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" /> Delete Brief
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
