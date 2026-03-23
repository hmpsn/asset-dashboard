import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, Target, ChevronDown, ChevronRight, RefreshCw,
  AlertCircle, Sparkles, Briefcase,
  BarChart3, Users, Search, FileText,
  Eye, MousePointerClick, Trophy,
} from 'lucide-react';
import { KeywordAnalysis } from './KeywordAnalysis';
import { StatCard, AIContextIndicator } from './ui';
import { BacklinkProfile } from './strategy/BacklinkProfile';
import { CompetitiveIntel } from './strategy/CompetitiveIntel';
import { PageKeywordMapPanel } from './strategy/PageKeywordMap';
import { ContentGaps } from './strategy/ContentGaps';
import { QuickWins } from './strategy/QuickWins';
import { KeywordGaps } from './strategy/KeywordGaps';
import { LowHangingFruit } from './strategy/LowHangingFruit';
import { keywords } from '../api/seo';

interface PageKeywordMap {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent?: string;
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

interface ContentGap {
  topic: string;
  targetKeyword: string;
  intent: string;
  priority: string;
  rationale: string;
  suggestedPageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource';
}

interface QuickWin {
  pagePath: string;
  action: string;
  estimatedImpact: string;
  rationale: string;
}

interface KeywordStrategy {
  siteKeywords: string[];
  siteKeywordMetrics?: { keyword: string; volume: number; difficulty: number }[];
  pageMap: PageKeywordMap[];
  opportunities: string[];
  contentGaps?: ContentGap[];
  quickWins?: QuickWin[];
  keywordGaps?: KeywordGapItem[];
  businessContext?: string;
  semrushMode?: 'quick' | 'full' | 'none';
  generatedAt: string;
}

interface SeoCopy {
  seoTitle: string;
  metaDescription: string;
  h1: string;
  introParagraph: string;
  internalLinkSuggestions?: { targetPath: string; anchorText: string; context: string }[];
  changes?: string[];
}

interface Props {
  workspaceId: string;
  siteId?: string;
}

type StrategyTab = 'strategy' | 'analysis';

export function KeywordStrategyPanel({ workspaceId, siteId }: Props) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<StrategyTab>('strategy');
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
  const [maxPages, setMaxPages] = useState<number>(500);
  const [competitors, setCompetitors] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progressStep, setProgressStep] = useState('');
  const [progressDetail, setProgressDetail] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [pageSearch, setPageSearch] = useState('');
  const [sortBy, setSortBy] = useState<'opportunity' | 'position' | 'volume' | 'impressions'>('opportunity');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [generatingCopy, setGeneratingCopy] = useState<string | null>(null);
  const [seoCopyResults, setSeoCopyResults] = useState<Map<string, SeoCopy>>(new Map());
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const stepLabels: Record<string, string> = {
    discovery: 'Discovering pages',
    content: 'Fetching page content',
    search_data: 'Search Console data',
    semrush: 'Keyword intelligence',
    ai: 'AI analysis',
    enrichment: 'Enriching data',
    complete: 'Complete',
  };

  const fetchStrategy = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const data = await keywords.webflowStrategy(workspaceId) as KeywordStrategy & { siteKeywords?: string[] };
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
    keywords.semrushStatus().then(d => {
      const status = d as { configured?: boolean } | null;
      if (status?.configured) {
        setSemrushAvailable(true);
        // Default to quick mode when SEMRush is available
        setSemrushMode(prev => prev === 'none' ? 'quick' : prev);
      }
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
    setProgressStep('');
    setProgressDetail('');
    setProgressPct(0);
    try {
      const compList = competitors.trim() ? competitors.split(/[,\n]+/).map(s => s.trim()).filter(Boolean) : undefined;
      const res = await fetch(`/api/webflow/keyword-strategy/${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({
          businessContext: businessContext.trim() || undefined,
          semrushMode: semrushAvailable ? semrushMode : 'none',
          competitorDomains: compList,
          maxPages: maxPages || undefined,
        }),
      });

      if (!res.ok || !res.body) {
        // Non-streaming error response (429, 400, 500, etc.) or no streaming support
        const data = await res.json();
        if (!res.ok || data.error) { setError(data.message || data.error || 'Request failed'); } else { setStrategy(data); }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.error) { setError(evt.error); break; }
            if (evt.done && evt.strategy) { setStrategy(evt.strategy); break; }
            if (evt.step) { setProgressStep(evt.step); setProgressDetail(evt.detail || ''); setProgressPct(evt.progress || 0); }
          } catch { /* skip malformed SSE */ }
        }
      }
    } catch {
      setError('Failed to generate strategy');
    } finally {
      setGenerating(false);
      setProgressStep('');
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
      const data = await keywords.patchStrategy(workspaceId, { pageMap: updated.pageMap }) as KeywordStrategy;
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

  const intentColor = (intent?: string) => {
    switch (intent) {
      case 'commercial': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
      case 'informational': return 'text-green-400 bg-green-500/10 border-green-500/20';
      case 'transactional': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'navigational': return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
      default: return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20';
    }
  };

  const getOpportunityScore = (p: PageKeywordMap) => {
    const pos = p.currentPosition || 999;
    const imp = p.impressions || 0;
    const vol = p.volume || 0;
    if (pos >= 4 && pos <= 20 && imp > 0) return imp * (21 - pos);
    if (pos > 20 && imp > 0) return imp * 2;
    if (pos <= 3) return imp * 0.5;
    if (vol > 0) return vol;
    return 1;
  };

  // Computed metrics
  const ranked = strategy?.pageMap.filter(p => p.currentPosition) || [];
  const avgPos = ranked.length > 0 ? ranked.reduce((s, p) => s + (p.currentPosition || 0), 0) / ranked.length : 0;
  const totalImpressions = strategy?.pageMap.reduce((s, p) => s + (p.impressions || 0), 0) || 0;
  const totalClicks = strategy?.pageMap.reduce((s, p) => s + (p.clicks || 0), 0) || 0;
  const top3 = ranked.filter(p => (p.currentPosition || 99) <= 3);
  const top10 = ranked.filter(p => (p.currentPosition || 99) <= 10 && (p.currentPosition || 0) > 3);
  const top20 = ranked.filter(p => (p.currentPosition || 99) <= 20 && (p.currentPosition || 0) > 10);
  const beyond20 = ranked.filter(p => (p.currentPosition || 0) > 20);
  const notRankingCount = (strategy?.pageMap.length || 0) - ranked.length;

  const lowHangingFruit = ranked
    .filter(p => (p.currentPosition || 0) >= 4 && (p.currentPosition || 0) <= 20 && (p.impressions || 0) > 20)
    .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
    .slice(0, 6);


  const generateSeoCopy = async (page: PageKeywordMap) => {
    setGeneratingCopy(page.pagePath);
    try {
      const data = await keywords.seoCopy({
        pagePath: page.pagePath,
        pageTitle: page.pageTitle,
        workspaceId,
      }) as SeoCopy & { error?: string };
      if (data.error) { console.error(data.error); return; }
      setSeoCopyResults(prev => new Map(prev).set(page.pagePath, data));
    } catch (err) {
      console.error('SEO copy generation failed:', err);
    } finally {
      setGeneratingCopy(null);
    }
  };

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const intentCounts = strategy?.pageMap.reduce((acc, p) => {
    const intent = p.searchIntent || 'unknown';
    acc[intent] = (acc[intent] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const filteredPages = (strategy?.pageMap || [])
    .filter(p => {
      if (!pageSearch) return true;
      const q = pageSearch.toLowerCase();
      return p.pageTitle.toLowerCase().includes(q) ||
             p.pagePath.toLowerCase().includes(q) ||
             p.primaryKeyword.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'position': cmp = (a.currentPosition || 999) - (b.currentPosition || 999); break;
        case 'volume': cmp = (b.volume || 0) - (a.volume || 0); break;
        case 'impressions': cmp = (b.impressions || 0) - (a.impressions || 0); break;
        case 'opportunity': cmp = getOpportunityScore(b) - getOpportunityScore(a); break;
      }
      return sortDir === 'asc' ? -cmp : cmp;
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
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

  // Sub-tab: Page Analysis
  if (activeTab === 'analysis' && siteId) {
    return (
      <div className="space-y-4">
        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-zinc-800 pb-0">
          {[
            { id: 'strategy' as const, label: 'Keyword Strategy', icon: Target },
            { id: 'analysis' as const, label: 'Page Analysis', icon: Search },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
                activeTab === t.id
                  ? 'border-teal-500 text-teal-300'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
        <KeywordAnalysis siteId={siteId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tab bar + Header */}
      {siteId && (
        <div className="flex items-center gap-1 border-b border-zinc-800 pb-0">
          {[
            { id: 'strategy' as const, label: 'Keyword Strategy', icon: Target },
            { id: 'analysis' as const, label: 'Page Analysis', icon: Search },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
                activeTab === t.id
                  ? 'border-teal-500 text-teal-300'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      )}
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
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

      {!strategy && !generating && (
        <AIContextIndicator workspaceId={workspaceId} feature="strategy" />
      )}

      {/* Progress Indicator */}
      {generating && progressStep && (
        <div className="bg-zinc-900 rounded-xl border border-teal-500/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
              <span className="text-xs font-medium text-zinc-200">{stepLabels[progressStep] || progressStep}</span>
            </div>
            <span className="text-[11px] text-zinc-500 font-mono">{Math.round(progressPct * 100)}%</span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-teal-500 to-teal-400 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${Math.round(progressPct * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-zinc-500">{progressDetail}</p>
        </div>
      )}

      {/* Settings Panel */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/20 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <Briefcase className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-xs font-semibold text-zinc-300">Strategy Settings</span>
            {!settingsOpen && (
              <span className="text-[11px] text-zinc-500">
                {semrushMode !== 'none' ? `SEMRush: ${semrushMode}` : ''}
                {maxPages > 0 ? `${semrushMode !== 'none' ? ' · ' : ''}${maxPages} pages max` : `${semrushMode !== 'none' ? ' · ' : ''}All pages`}
                {businessContext ? ` · Context set` : ''}
                {competitors.trim() ? ` · ${competitors.split(/[,\n]+/).filter(Boolean).length} competitors` : ''}
              </span>
            )}
          </div>
          {settingsOpen ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
        </button>
        {settingsOpen && (
          <div className="px-4 pb-4 space-y-4">
            {/* SEMRush Mode */}
            {semrushAvailable && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <BarChart3 className="w-3.5 h-3.5 text-orange-400" />
                  <span className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">SEMRush Data Mode</span>
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
                      <div className="text-[11px] mt-0.5 opacity-70">
                        {mode === 'none' && 'AI + GSC only'}
                        {mode === 'quick' && '~500 credits'}
                        {mode === 'full' && '~7,500 credits'}
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-500 mt-1.5">
                  {semrushMode === 'quick' && 'Enriches keywords with real search volume + difficulty scores from SEMRush.'}
                  {semrushMode === 'full' && 'Full competitive analysis: domain keywords, competitor gaps, related keywords, volume + difficulty.'}
                  {semrushMode === 'none' && 'Uses AI + Google Search Console data only. No SEMRush API credits used.'}
                </p>
              </div>
            )}

            {/* Competitor Domains */}
            {semrushAvailable && (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Users className="w-3.5 h-3.5 text-orange-400" />
                  <span className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">Competitor Domains</span>
                </div>
                <input
                  type="text"
                  value={competitors}
                  onChange={e => setCompetitors(e.target.value)}
                  placeholder="e.g. competitor1.com, competitor2.com"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                />
                <p className="text-[11px] text-zinc-500 mt-1">Comma-separated. SEMRush will find keywords they rank for that you don't (max 3).</p>
              </div>
            )}

            {/* Page Limit */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <FileText className="w-3.5 h-3.5 text-teal-400" />
                <span className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">Page Limit</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {([200, 500, 1000, 0] as const).map(cap => (
                  <button
                    key={cap}
                    onClick={() => setMaxPages(cap)}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                      maxPages === cap
                        ? 'border-teal-500/50 bg-teal-500/10 text-teal-300'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <div className="font-semibold">{cap === 0 ? 'All' : cap}</div>
                    <div className="text-[11px] mt-0.5 opacity-70">
                      {cap === 200 && '~2-3 min'}
                      {cap === 500 && '~5-7 min'}
                      {cap === 1000 && '~10-15 min'}
                      {cap === 0 && 'No limit'}
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-zinc-500 mt-1.5">
                {maxPages === 0
                  ? 'Processes every page on the site. May be slow for 500+ page sites.'
                  : `Prioritizes the top ${maxPages} pages by importance (homepage, key service pages, pages with metadata). Skips utility pages.`}
              </p>
            </div>

            {/* Business Context */}
            <div>
              <button
                onClick={() => setContextOpen(!contextOpen)}
                className="flex items-center gap-1.5 mb-1"
              >
                <Briefcase className="w-3.5 h-3.5 text-teal-400" />
                <span className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">Business Context</span>
                {contextOpen ? <ChevronDown className="w-3 h-3 text-zinc-500" /> : <ChevronRight className="w-3 h-3 text-zinc-500" />}
              </button>
              {contextOpen && (
                <div className="space-y-1.5">
                  <textarea
                    value={businessContext}
                    onChange={e => setBusinessContext(e.target.value)}
                    placeholder={`Example: We are a dental practice in Austin, TX. We offer general, cosmetic, and pediatric dentistry. Target audience: families 25-55. Competitors: Aspen Dental, local practices.`}
                    rows={3}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-teal-500 resize-y"
                  />
                  <p className="text-[11px] text-zinc-500">Saved with your strategy. Include: locations, services, audience, differentiators.</p>
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
          <Target className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
          <p className="text-sm text-zinc-400 mb-1">No keyword strategy yet</p>
          <p className="text-[11px] text-zinc-500 max-w-md mx-auto">
            Generate an AI-powered keyword strategy based on your site's pages and Google Search Console data.
            This will map target keywords to each page and guide all future AI rewrites.
          </p>
        </div>
      )}

      {strategy && (
        <>
          {/* ── Summary Dashboard ── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Pages Mapped" value={strategy.pageMap.length} />
            <StatCard label="Impressions" value={totalImpressions.toLocaleString()} icon={Eye} sub="last 90 days" />
            <StatCard label="Clicks" value={totalClicks.toLocaleString()} icon={MousePointerClick} sub={totalImpressions > 0 ? `${((totalClicks / totalImpressions) * 100).toFixed(1)}% CTR` : undefined} />
            <StatCard label="Avg Position" value={ranked.length > 0 ? `#${avgPos.toFixed(1)}` : '—'} icon={Trophy} valueColor={positionColor(avgPos)} sub={`${ranked.length} pages ranking`} />
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-1.5">Ranking Tiers</div>
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {top3.length > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">{top3.length} top 3</span>}
                {top10.length > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 font-medium">{top10.length} top 10</span>}
                {notRankingCount > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-500 font-medium">{notRankingCount} unranked</span>}
              </div>
            </div>
          </div>

          {/* ── Performance Tiers Bar ── */}
          {ranked.length > 0 && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-zinc-300">Ranking Distribution</h4>
                <span className="text-[11px] text-zinc-500">{ranked.length} of {strategy.pageMap.length} pages with ranking data</span>
              </div>
              <div className="flex h-4 rounded-full overflow-hidden bg-zinc-800">
                {top3.length > 0 && <div className="bg-emerald-500 h-full transition-all" style={{ width: `${(top3.length / strategy.pageMap.length) * 100}%` }} />}
                {top10.length > 0 && <div className="bg-green-500 h-full transition-all" style={{ width: `${(top10.length / strategy.pageMap.length) * 100}%` }} />}
                {top20.length > 0 && <div className="bg-amber-500 h-full transition-all" style={{ width: `${(top20.length / strategy.pageMap.length) * 100}%` }} />}
                {beyond20.length > 0 && <div className="bg-red-500/60 h-full transition-all" style={{ width: `${(beyond20.length / strategy.pageMap.length) * 100}%` }} />}
                {notRankingCount > 0 && <div className="bg-zinc-700 h-full transition-all" style={{ width: `${(notRankingCount / strategy.pageMap.length) * 100}%` }} />}
              </div>
              <div className="flex items-center gap-4 mt-2 flex-wrap">
                <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> <span className="text-emerald-400 font-medium">{top3.length}</span> <span className="text-zinc-500">Top 3</span></span>
                <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> <span className="text-green-400 font-medium">{top10.length}</span> <span className="text-zinc-500">4–10</span></span>
                <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> <span className="text-amber-400 font-medium">{top20.length}</span> <span className="text-zinc-500">11–20</span></span>
                <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2.5 h-2.5 rounded-full bg-red-500/60 inline-block" /> <span className="text-red-400 font-medium">{beyond20.length}</span> <span className="text-zinc-500">20+</span></span>
                <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2.5 h-2.5 rounded-full bg-zinc-700 inline-block" /> <span className="text-zinc-500 font-medium">{notRankingCount}</span> <span className="text-zinc-500">Not ranking</span></span>
              </div>
              {Object.keys(intentCounts).length > 1 && (
                <div className="mt-3 pt-3 border-t border-zinc-800">
                  <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">Search Intent Mix</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {Object.entries(intentCounts).sort((a, b) => b[1] - a[1]).map(([intent, count]) => (
                      <span key={intent} className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${intentColor(intent)}`}>
                        {intent} ({count})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Low-Hanging Fruit ── */}
          <LowHangingFruit pages={lowHangingFruit} positionColor={positionColor} />

          {/* ── Quick Wins ── */}
          <QuickWins quickWins={strategy.quickWins || []} />

          {/* ── Content Gaps ── */}
          <ContentGaps contentGaps={strategy.contentGaps || []} workspaceId={workspaceId} intentColor={intentColor} />

          {/* ── Site Keywords ── */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <h4 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5 text-teal-400" /> Site Target Keywords
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {strategy.siteKeywords.map((kw, i) => {
                const metrics = strategy.siteKeywordMetrics?.find(m => m.keyword.toLowerCase() === kw.toLowerCase());
                return (
                  <span key={i} className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-teal-500/10 border border-teal-500/20 rounded text-[11px] text-teal-300">
                    {kw}
                    {metrics && (metrics.volume > 0 || metrics.difficulty > 0) && (
                      <>
                        {metrics.volume > 0 && <span className="text-[11px] text-zinc-500 font-mono">{metrics.volume.toLocaleString()}/mo</span>}
                        {metrics.difficulty > 0 && <span className={`text-[11px] font-mono ${difficultyColor(metrics.difficulty)}`}>KD {metrics.difficulty}%</span>}
                      </>
                    )}
                  </span>
                );
              })}
            </div>
          </div>

          {/* ── Opportunities ── */}
          {strategy.opportunities.length > 0 && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <h4 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-teal-400" /> Keyword Opportunities
              </h4>
              <div className="space-y-1.5">
                {strategy.opportunities.map((opp, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] text-zinc-400">
                    <span className="w-4 h-4 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] text-teal-400 font-bold">{i + 1}</span>
                    {opp}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Page Keyword Map ── */}
          <PageKeywordMapPanel
            filteredPages={filteredPages}
            pageMap={strategy.pageMap}
            expandedPages={expandedPages}
            editingPage={editingPage}
            editDraft={editDraft}
            saving={saving}
            pageSearch={pageSearch}
            sortBy={sortBy}
            sortDir={sortDir}
            seoCopyResults={seoCopyResults}
            generatingCopy={generatingCopy}
            copiedField={copiedField}
            positionColor={positionColor}
            difficultyColor={difficultyColor}
            difficultyLabel={difficultyLabel}
            intentColor={intentColor}
            onTogglePage={togglePage}
            onStartEdit={startEdit}
            onSaveEdit={saveEdit}
            onSetEditingPage={setEditingPage}
            onSetEditDraft={setEditDraft}
            onSetPageSearch={setPageSearch}
            onSetSortBy={setSortBy}
            onSetSortDir={setSortDir}
            onGenerateSeoCopy={generateSeoCopy}
            onCopyText={copyText}
          />

          {/* Keyword Gaps */}
          <KeywordGaps keywordGaps={strategy.keywordGaps || []} difficultyColor={difficultyColor} />

          {/* Backlink Profile */}
          <BacklinkProfile workspaceId={workspaceId} />

          {/* Competitive Intelligence Hub */}
          <CompetitiveIntel
            workspaceId={workspaceId}
            competitors={competitors.split(/[,\n]+/).map(c => c.trim()).filter(Boolean)}
            semrushAvailable={semrushAvailable}
          />

          {/* How it works */}
          <div className="bg-zinc-800/30 rounded-lg border border-zinc-800 px-4 py-3">
            <div className="flex items-start gap-2">
              <Sparkles className="w-3.5 h-3.5 text-teal-400 mt-0.5 flex-shrink-0" />
              <div className="text-[11px] text-zinc-500">
                <strong className="text-zinc-400">How it works:</strong> This strategy is automatically used when you generate AI rewrites
                in the Edit SEO and CMS SEO tabs. The AI will incorporate your target keywords naturally into titles and descriptions.
                Use the <strong className="text-teal-400">Generate SEO Copy</strong> button on any page to get rewritten title, meta, H1, and intro paragraph.
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
