import { useState, useEffect } from 'react';
import {
  Loader2, Target, ChevronDown, ChevronRight, RefreshCw,
  TrendingUp, AlertCircle, Sparkles, Pencil, Check, X, Briefcase,
  BarChart3, Shield, DollarSign, Users,
} from 'lucide-react';

interface PageKeywordMap {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  currentPosition?: number;
  impressions?: number;
  clicks?: number;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
}

interface KeywordGapItem {
  keyword: string;
  volume: number;
  difficulty: number;
  competitorPosition: number;
  competitorDomain: string;
}

interface KeywordStrategy {
  siteKeywords: string[];
  pageMap: PageKeywordMap[];
  opportunities: string[];
  keywordGaps?: KeywordGapItem[];
  businessContext?: string;
  semrushMode?: 'quick' | 'full' | 'none';
  generatedAt: string;
}

interface Props {
  workspaceId: string;
}

export function KeywordStrategyPanel({ workspaceId }: Props) {
  const [strategy, setStrategy] = useState<KeywordStrategy | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPages, setExpandedPages] = useState<Set<number>>(new Set());
  const [editingPage, setEditingPage] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ primary: string; secondary: string }>({ primary: '', secondary: '' });
  const [saving, setSaving] = useState(false);
  const [businessContext, setBusinessContext] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [semrushAvailable, setSemrushAvailable] = useState(false);
  const [semrushMode, setSemrushMode] = useState<'none' | 'quick' | 'full'>('none');
  const [competitors, setCompetitors] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fetchStrategy = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/webflow/keyword-strategy/${workspaceId}`);
      const data = await res.json();
      if (data && data.siteKeywords) {
        setStrategy(data);
      }
    } catch {
      // No strategy yet
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStrategy(); }, [workspaceId]);

  // Check SEMRush availability
  useEffect(() => {
    fetch('/api/semrush/status').then(r => r.json()).then(d => {
      if (d.configured) setSemrushAvailable(true);
    }).catch(() => {});
  }, []);

  // Sync business context + competitors from loaded strategy
  useEffect(() => {
    if (strategy?.businessContext && !businessContext) {
      setBusinessContext(strategy.businessContext);
    }
    if (strategy?.semrushMode && strategy.semrushMode !== 'none') {
      setSemrushMode(strategy.semrushMode);
    }
  }, [strategy]);

  const generateStrategy = async () => {
    setGenerating(true);
    setError(null);
    try {
      const compList = competitors.trim() ? competitors.split(/[,\n]+/).map(s => s.trim()).filter(Boolean) : undefined;
      const res = await fetch(`/api/webflow/keyword-strategy/${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessContext: businessContext.trim() || undefined,
          semrushMode: semrushAvailable ? semrushMode : 'none',
          competitorDomains: compList,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setStrategy(data);
      }
    } catch {
      setError('Failed to generate strategy');
    } finally {
      setGenerating(false);
    }
  };

  const togglePage = (idx: number) => {
    setExpandedPages(prev => {
      const n = new Set(prev);
      if (n.has(idx)) n.delete(idx); else n.add(idx);
      return n;
    });
  };

  const startEdit = (idx: number) => {
    const page = strategy?.pageMap[idx];
    if (!page) return;
    setEditingPage(idx);
    setEditDraft({
      primary: page.primaryKeyword,
      secondary: page.secondaryKeywords.join(', '),
    });
  };

  const saveEdit = async () => {
    if (editingPage === null || !strategy) return;
    setSaving(true);
    const updated = { ...strategy };
    updated.pageMap = [...updated.pageMap];
    updated.pageMap[editingPage] = {
      ...updated.pageMap[editingPage],
      primaryKeyword: editDraft.primary.trim(),
      secondaryKeywords: editDraft.secondary.split(',').map(s => s.trim()).filter(Boolean),
    };
    try {
      const res = await fetch(`/api/webflow/keyword-strategy/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageMap: updated.pageMap }),
      });
      const data = await res.json();
      if (data.pageMap) setStrategy(data);
      setEditingPage(null);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const positionColor = (pos?: number) => {
    if (!pos) return 'text-zinc-500';
    if (pos <= 3) return 'text-emerald-400';
    if (pos <= 10) return 'text-green-400';
    if (pos <= 20) return 'text-amber-400';
    return 'text-red-400';
  };

  const difficultyColor = (kd?: number) => {
    if (kd === undefined) return 'text-zinc-500';
    if (kd <= 30) return 'text-emerald-400';
    if (kd <= 50) return 'text-amber-400';
    if (kd <= 70) return 'text-orange-400';
    return 'text-red-400';
  };

  const difficultyLabel = (kd?: number) => {
    if (kd === undefined) return '';
    if (kd <= 30) return 'Easy';
    if (kd <= 50) return 'Medium';
    if (kd <= 70) return 'Hard';
    return 'Very Hard';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
        <span className="ml-3 text-sm text-zinc-400">Loading keyword strategy...</span>
      </div>
    );
  }

  if (!workspaceId) {
    return (
      <div className="text-center py-16 text-zinc-500 text-sm">
        No workspace selected. Link a workspace to generate a keyword strategy.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Keyword Strategy</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {strategy
              ? `Generated ${new Date(strategy.generatedAt).toLocaleDateString()} · ${strategy.pageMap.length} pages mapped`
              : 'AI-powered keyword mapping for your entire site'}
          </p>
        </div>
        <button
          onClick={generateStrategy}
          disabled={generating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
        >
          {generating ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Generating...</>
          ) : strategy ? (
            <><RefreshCw className="w-3 h-3" /> Regenerate</>
          ) : (
            <><Sparkles className="w-3 h-3" /> Generate Strategy</>
          )}
        </button>
      </div>

      {/* Settings Panel */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/20 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <Briefcase className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-xs font-semibold text-zinc-300">Strategy Settings</span>
            {!settingsOpen && (
              <span className="text-[10px] text-zinc-500">
                {semrushMode !== 'none' ? `SEMRush: ${semrushMode}` : ''}
                {businessContext ? ` · Context set` : ''}
                {competitors.trim() ? ` · ${competitors.split(/[,\n]+/).filter(Boolean).length} competitors` : ''}
              </span>
            )}
          </div>
          {settingsOpen ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />}
        </button>
        {settingsOpen && (
          <div className="px-4 pb-4 space-y-4">
            {/* SEMRush Mode */}
            {semrushAvailable && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <BarChart3 className="w-3.5 h-3.5 text-orange-400" />
                  <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">SEMRush Data Mode</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(['none', 'quick', 'full'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setSemrushMode(mode)}
                      className={`px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                        semrushMode === mode
                          ? 'border-orange-500/50 bg-orange-500/10 text-orange-300'
                          : 'border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      <div className="font-semibold capitalize">{mode === 'none' ? 'Off' : mode}</div>
                      <div className="text-[9px] mt-0.5 opacity-70">
                        {mode === 'none' && 'AI + GSC only'}
                        {mode === 'quick' && '~500 credits'}
                        {mode === 'full' && '~7,500 credits'}
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-600 mt-1.5">
                  {semrushMode === 'quick' && 'Enriches keywords with real search volume + difficulty scores from SEMRush.'}
                  {semrushMode === 'full' && 'Full competitive analysis: domain keywords, competitor gaps, related keywords, volume + difficulty.'}
                  {semrushMode === 'none' && 'Uses AI + Google Search Console data only. No SEMRush API credits used.'}
                </p>
              </div>
            )}

            {/* Competitor Domains */}
            {semrushAvailable && semrushMode === 'full' && (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Users className="w-3.5 h-3.5 text-orange-400" />
                  <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">Competitor Domains</span>
                </div>
                <input
                  type="text"
                  value={competitors}
                  onChange={e => setCompetitors(e.target.value)}
                  placeholder="e.g. competitor1.com, competitor2.com"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500"
                />
                <p className="text-[10px] text-zinc-600 mt-1">Comma-separated. SEMRush will find keywords they rank for that you don't (max 3).</p>
              </div>
            )}

            {/* Business Context */}
            <div>
              <button
                onClick={() => setContextOpen(!contextOpen)}
                className="flex items-center gap-1.5 mb-1"
              >
                <Briefcase className="w-3.5 h-3.5 text-violet-400" />
                <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">Business Context</span>
                {contextOpen ? <ChevronDown className="w-3 h-3 text-zinc-600" /> : <ChevronRight className="w-3 h-3 text-zinc-600" />}
              </button>
              {contextOpen && (
                <div className="space-y-1.5">
                  <textarea
                    value={businessContext}
                    onChange={e => setBusinessContext(e.target.value)}
                    placeholder={`Example: We are a dental practice in Austin, TX. We offer general, cosmetic, and pediatric dentistry. Target audience: families 25-55. Competitors: Aspen Dental, local practices.`}
                    rows={3}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 resize-y"
                  />
                  <p className="text-[10px] text-zinc-600">Saved with your strategy. Include: locations, services, audience, differentiators.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-xs text-red-400 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </div>
      )}

      {!strategy && !generating && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-6 py-12 text-center">
          <Target className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-sm text-zinc-400 mb-1">No keyword strategy yet</p>
          <p className="text-[11px] text-zinc-600 max-w-md mx-auto">
            Generate an AI-powered keyword strategy based on your site's pages and Google Search Console data.
            This will map target keywords to each page and guide all future AI rewrites.
          </p>
        </div>
      )}

      {strategy && (
        <>
          {/* Site Keywords */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <h4 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5 text-violet-400" /> Site Target Keywords
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {strategy.siteKeywords.map((kw, i) => (
                <span key={i} className="px-2 py-0.5 bg-violet-500/10 border border-violet-500/20 rounded text-[11px] text-violet-300">
                  {kw}
                </span>
              ))}
            </div>
          </div>

          {/* Opportunities */}
          {strategy.opportunities.length > 0 && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <h4 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> Keyword Opportunities
              </h4>
              <ul className="space-y-1.5">
                {strategy.opportunities.map((opp, i) => (
                  <li key={i} className="text-[11px] text-zinc-400 flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5 flex-shrink-0">•</span>
                    {opp}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Page Keyword Map */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h4 className="text-xs font-semibold text-zinc-300">Page Keyword Map</h4>
              <p className="text-[10px] text-zinc-600 mt-0.5">Click a page to see details. Use the edit button to refine keywords.</p>
            </div>
            {strategy.pageMap.map((page, idx) => {
              const isExpanded = expandedPages.has(idx);
              const isEditing = editingPage === idx;

              return (
                <div key={idx} className="border-b border-zinc-800/50 last:border-b-0">
                  <button
                    onClick={() => togglePage(idx)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/20 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />}
                      <span className="text-xs text-zinc-300 truncate">{page.pageTitle}</span>
                      <span className="text-[10px] text-zinc-600 font-mono flex-shrink-0">{page.pagePath}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded max-w-[200px] truncate">
                        {page.primaryKeyword}
                      </span>
                      {page.volume !== undefined && (
                        <span className="text-[9px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded font-mono">
                          {page.volume.toLocaleString()}/mo
                        </span>
                      )}
                      {page.difficulty !== undefined && (
                        <span className={`text-[9px] ${difficultyColor(page.difficulty)} bg-zinc-800 px-1.5 py-0.5 rounded font-mono`}>
                          KD {page.difficulty}%
                        </span>
                      )}
                      {page.currentPosition && (
                        <span className={`text-[10px] ${positionColor(page.currentPosition)} font-mono`}>
                          #{page.currentPosition.toFixed(0)}
                        </span>
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 pl-10 space-y-2">
                      {!isEditing ? (
                        <>
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Primary Keyword</span>
                              <p className="text-xs text-zinc-200 mt-0.5">{page.primaryKeyword}</p>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); startEdit(idx); }}
                              className="p-1 text-zinc-500 hover:text-violet-400 transition-colors"
                              title="Edit keywords"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                          <div>
                            <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Secondary Keywords</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {page.secondaryKeywords.map((kw, i) => (
                                <span key={i} className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[10px] text-zinc-400">
                                  {kw}
                                </span>
                              ))}
                            </div>
                          </div>
                          {/* Metrics row */}
                          <div className="flex flex-wrap gap-3 mt-1">
                            {page.volume !== undefined && (
                              <div className="text-[10px] text-zinc-500 flex items-center gap-1">
                                <BarChart3 className="w-3 h-3 text-orange-400" />
                                <span className="text-zinc-300 font-medium">{page.volume.toLocaleString()}</span>/mo
                              </div>
                            )}
                            {page.difficulty !== undefined && (
                              <div className="text-[10px] text-zinc-500 flex items-center gap-1">
                                <Shield className="w-3 h-3" />
                                KD: <span className={`font-medium ${difficultyColor(page.difficulty)}`}>{page.difficulty}%</span>
                                <span className={`text-[9px] ${difficultyColor(page.difficulty)}`}>({difficultyLabel(page.difficulty)})</span>
                              </div>
                            )}
                            {page.cpc !== undefined && page.cpc > 0 && (
                              <div className="text-[10px] text-zinc-500 flex items-center gap-1">
                                <DollarSign className="w-3 h-3 text-green-400" />
                                CPC: <span className="text-green-400 font-medium">${page.cpc.toFixed(2)}</span>
                              </div>
                            )}
                            {page.impressions !== undefined && (
                              <div className="text-[10px] text-zinc-500">
                                <span className="text-zinc-400 font-medium">{page.impressions.toLocaleString()}</span> impressions
                              </div>
                            )}
                            {page.clicks !== undefined && (
                              <div className="text-[10px] text-zinc-500">
                                <span className="text-zinc-400 font-medium">{page.clicks.toLocaleString()}</span> clicks
                              </div>
                            )}
                            {page.currentPosition && (
                              <div className="text-[10px] text-zinc-500">
                                Avg position: <span className={`font-medium ${positionColor(page.currentPosition)}`}>#{page.currentPosition.toFixed(1)}</span>
                              </div>
                            )}
                          </div>
                          {/* Secondary keyword metrics */}
                          {page.secondaryMetrics && page.secondaryMetrics.length > 0 && (
                            <div className="mt-1">
                              <span className="text-[9px] text-zinc-600 uppercase tracking-wider">Secondary keyword data</span>
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {page.secondaryMetrics.map((sm, si) => (
                                  <span key={si} className="text-[9px] px-1.5 py-0.5 bg-zinc-800/80 border border-zinc-700/50 rounded text-zinc-500">
                                    {sm.keyword} <span className="text-zinc-400">{sm.volume}/mo</span> <span className={difficultyColor(sm.difficulty)}>KD {sm.difficulty}%</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="space-y-2">
                          <div>
                            <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider block mb-1">Primary Keyword</label>
                            <input
                              type="text"
                              value={editDraft.primary}
                              onChange={e => setEditDraft(prev => ({ ...prev, primary: e.target.value }))}
                              className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-violet-500"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider block mb-1">Secondary Keywords (comma-separated)</label>
                            <input
                              type="text"
                              value={editDraft.secondary}
                              onChange={e => setEditDraft(prev => ({ ...prev, secondary: e.target.value }))}
                              className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-violet-500"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={saveEdit}
                              disabled={saving}
                              className="flex items-center gap-1 px-2.5 py-1 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-[11px] font-medium"
                            >
                              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                            </button>
                            <button
                              onClick={() => setEditingPage(null)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-[11px] font-medium"
                            >
                              <X className="w-3 h-3" /> Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Keyword Gaps */}
          {strategy.keywordGaps && strategy.keywordGaps.length > 0 && (
            <div className="bg-zinc-900 rounded-xl border border-orange-500/20 p-4">
              <h4 className="text-xs font-semibold text-orange-300 mb-2 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Competitor Keyword Gaps
              </h4>
              <p className="text-[10px] text-zinc-500 mb-2">Keywords your competitors rank for that you don't — high-priority opportunities.</p>
              <div className="space-y-1">
                {strategy.keywordGaps.map((gap, i) => (
                  <div key={i} className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-800/50 rounded-lg">
                    <span className="text-[11px] text-zinc-300">{gap.keyword}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-zinc-500 font-mono">{gap.volume.toLocaleString()}/mo</span>
                      <span className={`text-[9px] font-mono ${difficultyColor(gap.difficulty)}`}>KD {gap.difficulty}%</span>
                      <span className="text-[9px] text-zinc-600">{gap.competitorDomain} #{gap.competitorPosition}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* How it works */}
          <div className="bg-zinc-800/30 rounded-lg border border-zinc-800 px-4 py-3">
            <div className="flex items-start gap-2">
              <Sparkles className="w-3.5 h-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
              <div className="text-[11px] text-zinc-500">
                <strong className="text-zinc-400">How it works:</strong> This strategy is automatically used when you generate AI rewrites
                in the Edit SEO and CMS SEO tabs. The AI will incorporate your target keywords naturally into titles and descriptions.
                Edit any page's keywords to refine the strategy.
                {strategy.semrushMode && strategy.semrushMode !== 'none' && (
                  <span className="block mt-1 text-orange-400/80">
                    SEMRush data: Keywords enriched with real search volume and difficulty. Cached for 7 days.
                  </span>
                )}
                {!strategy.pageMap.some(p => p.currentPosition) && (
                  <span className="block mt-1 text-amber-400/80">
                    Tip: Connect Google Search Console to see ranking positions and get data-driven keyword suggestions.
                  </span>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
