import { useState, useEffect } from 'react';
import { Loader2, Clipboard, Trash2, ChevronDown, ChevronUp, Sparkles, FileText } from 'lucide-react';

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

export function ContentBriefs({ workspaceId }: { workspaceId: string }) {
  const [briefs, setBriefs] = useState<ContentBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [businessCtx, setBusinessCtx] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/content-briefs/${workspaceId}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setBriefs(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workspaceId]);

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
